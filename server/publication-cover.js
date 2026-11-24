import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { imageSize } from './fiiu-talk-domain.js';

const MAX_JPEG = 300 * 1024;
const PREFIX = 'data:image/jpeg;base64,';
export const COVER_BODY_LIMIT = 4 * Math.ceil(MAX_JPEG / 3) + 128 * 1024;
export const COVER_ROUTE = /^\/api\/publication-covers\/(news|opportunity)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{64})\.jpg$/;
export const coverUrl = (kind, id, revision) => revision ? `/api/publication-covers/${kind}/${id}/${revision}.jpg` : '';

function invalid(field, message) {
  throw Object.assign(new Error(message), {status:400, field});
}

// The desk frames the original at full email resolution. Decode and save only its pixels,
// never the original filename, GPS coordinates, comments or other image metadata.
export function coverUpdate(input) {
  const update = {};
  if (input.coverImage === null) return {coverRevision:'',coverJpeg:null,coverAlt:''};
  if (input.coverAlt !== undefined) {
    if (typeof input.coverAlt !== 'string') invalid('coverAlt','image description must be text');
    update.coverAlt = input.coverAlt.replace(/\s+/gu,' ').trim();
    if (update.coverAlt.length > 240) invalid('coverAlt','image description exceeds 240 characters');
  }
  if (input.coverImage === undefined) return update;
  const uri = input.coverImage;
  if (typeof uri !== 'string' || !uri.startsWith(PREFIX) || uri.length > PREFIX.length + 4 * Math.ceil(MAX_JPEG / 3)) {
    invalid('coverImage','expected a JPEG cover of at most 300 KiB');
  }
  const raw = uri.slice(PREFIX.length);
  const bytes = Buffer.from(raw,'base64');
  if (bytes.length < 4 || bytes.toString('base64') !== raw || bytes.readUInt16BE(bytes.length-2) !== 0xffd9) {
    invalid('coverImage','invalid cover image');
  }
  const size = imageSize(bytes,'image/jpeg');
  if (size?.width !== 1080 || size.height !== 600) invalid('coverImage','expected a 1080 by 600 pixel cover');
  let pixels;
  try { pixels = jpeg.decode(bytes,{tolerantDecoding:false,maxResolutionInMP:0.65,maxMemoryUsageInMB:48}); }
  catch { invalid('coverImage','invalid cover image'); }
  if (pixels.width !== 1080 || pixels.height !== 600) invalid('coverImage','unexpected cover dimensions');
  for (const quality of [84,65,45]) {
    const canonical = jpeg.encode({width:1080,height:600,data:pixels.data}, quality).data;
    if (canonical.length <= MAX_JPEG) {
      update.coverJpeg = Buffer.from(canonical);
      update.coverRevision = createHash('sha256').update(canonical).digest('hex');
      return update;
    }
  }
  invalid('coverImage','image exceeds the cover size limit');
}

export function postgresJpeg(bytes) {
  return bytes === null ? null : '\\x' + bytes.toString('hex');
}

// Only public images can be resolved by an email client. Staff can preview the current
// draft with their existing session, without publishing it. The SQL guards bind visibility
// and version to the binary read, including when an editor replaces a cover concurrently.
export async function readPublicationCover({db,admin},kind,id,revision,staff) {
  const news = kind === 'news';
  const table = news ? 'nodal_news' : 'catalog_items';
  if (db) {
    const filters = [!news && "kind='opportunity'", !staff && "status='published'", !staff && !news && "visibility='public'"].filter(Boolean);
    const row = db.prepare(`SELECT cover_jpeg FROM ${table} WHERE id=? AND cover_revision=?${filters.map(s=>' AND '+s).join('')}`).get(id,revision);
    return row?.cover_jpeg ? Buffer.from(row.cover_jpeg) : null;
  }
  const rows = await admin.rest(table,{query:{
    select:'cover_jpeg',id:'eq.'+id,cover_revision:'eq.'+revision,limit:1,
    ...(!news && {kind:'eq.opportunity'}),...(!staff && {status:'eq.published'}),...(!staff && !news && {visibility:'eq.public'}),
  }});
  const data = rows[0]?.cover_jpeg;
  return typeof data === 'string' && data.startsWith('\\x') ? Buffer.from(data.slice(2),'hex') : null;
}

// These columns feed list/detail reads and never include the binary.
export const catalogColumns = (sqlite=false) => [
  'id','kind','subtype','status','visibility',sqlite?'translations_json':'translations','organization','public_byline',
  'cover_revision','cover_alt','location',sqlite?'topics_json':'topics','starts_at','deadline_at','end_date','source_label',
  'source_url','source_verified_at','action_mode','action_url','featured','version','created_by','updated_by','published_by',
  'published_at','created_at','updated_at',
].join(',');

export function catalogCoverUpdate(item) {
  if (item.kind === 'opportunity') return coverUpdate(item);
  if (item.coverImage != null) invalid('coverImage', 'only opportunities have cover images');
  // Changing an opportunity into another kind drops its stored image in the same write.
  return {coverRevision:'', coverJpeg:null, coverAlt:''};
}

export function catalogCoverView(row) {
  return row.kind === 'opportunity' && row.cover_revision
    ? {coverUrl:coverUrl('opportunity',row.id,row.cover_revision), coverAlt:row.cover_alt || ''}
    : {};
}
