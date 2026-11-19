import jpeg from 'jpeg-js';
import { imageSize } from './fiiu-talk-domain.js';

export const MAX_PHOTO_BYTES = 128 * 1024;
const MAX_SIDE = 512;

export function normalizeProfilePhoto(bytes) {
  const invalid = () => Object.assign(new Error('expected a square JPEG up to 512 pixels'), { status: 400 });
  const size = imageSize(bytes, 'image/jpeg');
  if (!size || size.width !== size.height || size.width > MAX_SIDE || bytes.readUInt16BE(0) !== 0xffd8
    || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw invalid();
  let decoded;
  try {
    decoded = jpeg.decode(bytes, { tolerantDecoding: false, maxResolutionInMP: 0.263, maxMemoryUsageInMB: 24 });
  } catch { throw invalid(); }
  if (decoded.width !== size.width || decoded.height !== size.height) throw invalid();
  // Only pixels go into the stored JPEG, so the source filename, comments, GPS and camera metadata stay off profiles.
  const pixels = { width: decoded.width, height: decoded.height, data: decoded.data };
  for (const quality of [78, 58, 38]) {
    const canonical = jpeg.encode(pixels, quality).data;
    if (canonical.length <= MAX_PHOTO_BYTES) return canonical;
  }
  throw Object.assign(new Error('profile photo is too large'), { status: 413 });
}
