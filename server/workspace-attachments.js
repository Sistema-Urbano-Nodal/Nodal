import { isUtf8 } from 'node:buffer';
import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_BYTES, attachmentFilename, fail } from './courses-domain.js';
import { drawableBytes } from './fiiu-talk-domain.js';

const officePrefix = 'application/vnd.openxmlformats-officedocument.';
const office = {
  [officePrefix + 'wordprocessingml.document']: { ext: '.docx', main: 'word/document.xml' },
  [officePrefix + 'spreadsheetml.sheet']: { ext: '.xlsx', main: 'xl/workbook.xml' },
  [officePrefix + 'presentationml.presentation']: { ext: '.pptx', main: 'ppt/presentation.xml' },
};
const extensions = { ...ATTACHMENT_EXTENSIONS, 'text/csv': ['.csv'] };
for (const [mime, { ext }] of Object.entries(office)) extensions[mime] = [ext];
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10]);
function pdfFile(bytes) {
  if (!/^%PDF-[12]\.\d/.test(bytes.toString('latin1',0,8))) return false;
  const tail = bytes.toString('latin1',Math.max(0,bytes.length-2048));
  const end = /startxref\s+(\d+)\s+%%EOF[\t\n\r\f ]*$/.exec(tail);
  if (!end) return false;
  const offset = Number(end[1]);
  if (!Number.isSafeInteger(offset) || offset < 8 || offset >= bytes.length) return false;
  // PDF 1.5+ can point at an indirect cross-reference stream instead of an xref table.
  return /^(?:xref\s|\d+\s+\d+\s+obj\b)/.test(bytes.toString('latin1',offset,offset+48));
}

// The raw aggregate fits in 4 MiB of base64. Reserve space for the four filenames,
// a full message and JSON escaping without crossing the hosting request limit.
export const WORKSPACE_JSON_LIMIT = 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3) + 64 * 1024;
export const workspaceFilename = (name, mime) => attachmentFilename(name, mime, extensions);

function rasterFile(bytes, mime) {
  if (!drawableBytes(bytes, mime)) return false;
  if (mime === 'image/png') {
    if (!bytes.subarray(0,8).equals(pngHeader) || bytes.readUInt32BE(8)!==13) return false;
    let hasData = false;
    for (let offset=8; offset+12<=bytes.length;) {
      const length=bytes.readUInt32BE(offset), type=bytes.toString('latin1',offset+4,offset+8);
      const next = offset + length + 12;
      if (next > bytes.length || crc32(bytes.subarray(offset+4,next-4)) !== bytes.readUInt32BE(next-4)) return false;
      offset = next;
      if (type==='IDAT' && length>0) hasData=true;
      if (type==='IEND') return hasData && length===0 && offset===bytes.length;
    }
    return false;
  }
  if (mime === 'image/jpeg') {
    if (bytes.readUInt16BE(0)!==0xffd8 || bytes.readUInt16BE(bytes.length-2)!==0xffd9) return false;
    for (let at=2; at+4<bytes.length;) {
      if (bytes[at]!==0xff) return false;
      const marker=bytes[at+1];
      if (marker===0xff) { at++; continue; }
      if (marker===0x01) { at+=2; continue; }
      const size=bytes.readUInt16BE(at+2);
      if (size<2 || at+size+2>bytes.length) return false;
      if (marker===0xda) return at+size+2<bytes.length-2;
      at+=size+2;
    }
    return false;
  }
  if (mime !== 'image/webp' || bytes.toString('latin1',0,4)!=='RIFF' || bytes.toString('latin1',8,12)!=='WEBP' ||
      bytes.readUInt32LE(4)!==bytes.length-8) return false;
  let frame = false, at=12;
  while (at+8<=bytes.length) {
    const type=bytes.toString('latin1',at,at+4), length=bytes.readUInt32LE(at+4);
    at+=8+length+(length%2);
    if ((type==='VP8 ' && length>10) || (type==='VP8L' && length>5) || (type==='ANMF' && length>24)) frame=true;
  }
  return at===bytes.length && frame;
}

async function officeFile(bytes, mime) {
  const main = office[mime].main;
  const pkg = await fromBufferPromise(bytes, { strictFileNames: true });
  if (pkg.entryCount>4096) return false;
  let manifest, hasMain=false;
  for await (const entry of pkg.eachEntry()) {
    if (!entry.canDecodeFileData() || /(?:^|\/)vbaProject\.bin$/i.test(entry.fileName)) return false;
    if (entry.fileName===main) {
      if (hasMain || !entry.uncompressedSize) return false;
      hasMain=true;
    }
    if (entry.fileName==='[Content_Types].xml') {
      if (manifest || entry.uncompressedSize>512*1024) return false;
      const stream=await pkg.openReadStreamPromise(entry), chunks=[];
      // yauzl verifies the real output length against the bounded size above while it inflates.
      for await (const chunk of stream) chunks.push(chunk);
      manifest=Buffer.concat(chunks).toString('utf8');
    }
  }
  if (!hasMain || !manifest) return false;
  // An OOXML main part must also be declared for this exact document type.
  return Array.from(manifest.matchAll(/<(?:[\w.-]+:)?Override\s+([^<>]+)>/g), ([,attr])=>attr).some(attr=>
    /\bPartName\s*=\s*["']([^"']+)["']/.exec(attr)?.[1]==='/'+main &&
    /\bContentType\s*=\s*["']([^"']+)["']/.exec(attr)?.[1]===mime+'.main+xml');
}

export async function normalizeWorkspaceAttachments(files) {
  if (!Array.isArray(files) || files.length>4) fail('choose up to four attachments');
  let total=0;
  const normalized=[];
  for (const file of files) {
    if (!file || typeof file.name!=='string' || !file.name.trim() || file.name.length>160 || !file.name.isWellFormed() ||
        typeof file.mime!=='string' || !Object.hasOwn(extensions,file.mime) || typeof file.data!=='string' || !Number.isSafeInteger(file.size) || file.size<=0) fail('invalid attachment');
    total+=file.size;
    if (total>MAX_ATTACHMENT_BYTES) fail('attachments exceed 3 MiB',413);
    if (file.data.length!==4*Math.ceil(file.size/3)) fail('invalid attachment size');
    const bytes=Buffer.from(file.data,'base64');
    if (bytes.length!==file.size || bytes.toString('base64')!==file.data) fail('invalid attachment encoding');
    let valid;
    if (file.mime.startsWith('image/')) valid=rasterFile(bytes,file.mime);
    else if (file.mime==='application/pdf') {
      valid=pdfFile(bytes);
    } else if (Object.hasOwn(office,file.mime)) {
      try { valid=await officeFile(bytes,file.mime); } catch { valid=false; }
    } else {
      valid=isUtf8(bytes) && !bytes.some(byte=>byte<32 && ![9,10,12,13].includes(byte));
    }
    if (!valid) fail('attachment content does not match its type');
    normalized.push({ name:workspaceFilename(file.name,file.mime), mime:file.mime, size:file.size, data:file.data });
  }
  return normalized;
}

export function downloadWorkspaceAttachment({res,send,file,inline,downloads,actorId}) {
  if (!Object.hasOwn(extensions,file?.mime) || !Number.isSafeInteger(file.size) || file.size<1 ||
      file.size>MAX_ATTACHMENT_BYTES || typeof file.data!=='string' || file.data.length!==Math.ceil(file.size/3)*4) fail('attachment unavailable',502);
  const bytes=Buffer.from(file.data,'base64');
  if (bytes.length!==file.size) fail('attachment unavailable',502);
  const budget=downloads.take('download:'+actorId,bytes.length);
  if (!budget.ok) return send(res,429,{error:'download limit reached'},{'Retry-After':String(budget.retryAfter)});
  const disposition=inline && file.mime.startsWith('image/') && rasterFile(bytes,file.mime) ? 'inline' : 'attachment';
  const name=workspaceFilename(file.name,file.mime);
  const encoded=encodeURIComponent(name).replace(/['()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());
  send(res,200,bytes,{
    'Content-Type':file.mime, 'Content-Length':String(bytes.length), 'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; sandbox", Vary:'Cookie',
    'Content-Disposition':`${disposition}; filename="${name.replace(/[^a-zA-Z0-9._ -]/g,'_')}"; filename*=UTF-8''${encoded}`,
  });
}
