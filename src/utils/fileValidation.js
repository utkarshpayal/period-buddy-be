/**
 * Server-side file-content validation by magic bytes.
 *
 * The multer fileFilters only see the client-declared `mimetype`, which is
 * trivially spoofable. Because uploads land in a publicly-readable S3 bucket
 * (and medical documents are the most sensitive surface), we additionally
 * sniff the real bytes here and reject anything whose content doesn't match a
 * known-good signature. Text-based formats like SVG have no binary magic and
 * therefore fail this check — which is intended, since SVG can carry script
 * (stored XSS when served back from the bucket domain).
 *
 * Dependency-free on purpose: a handful of signatures covers every format the
 * app actually accepts, and avoids pulling in a new package.
 */

const startsWith = (buf, bytes, offset = 0) => {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
};

// RIFF containers (WEBP/WAV/AVI) share a 'RIFF' header + a form-type at byte 8.
const isRiff = (buf, formType) =>
  startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
  buf.length >= 12 &&
  formType.every((b, i) => buf[8 + i] === b);

// ISO base-media (MP4/MOV/M4A/M4V/AAC/AVIF/HEIC) have 'ftyp' at byte 4.
const isIsoBmff = (buf) => buf.length >= 12 && startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4);

const detectors = {
  // images
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/gif': (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]),
  'image/webp': (b) => isRiff(b, [0x57, 0x45, 0x42, 0x50]), // "WEBP"
  'image/avif': (b) => isIsoBmff(b),
  // documents
  'application/pdf': (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]), // "%PDF"
  // audio
  'audio/mpeg': (b) => startsWith(b, [0x49, 0x44, 0x33]) || startsWith(b, [0xff, 0xfb]),
  'audio/wav': (b) => isRiff(b, [0x57, 0x41, 0x56, 0x45]), // "WAVE"
  'audio/ogg': (b) => startsWith(b, [0x4f, 0x67, 0x67, 0x53]), // "OggS"
  'audio/mp4': (b) => isIsoBmff(b),
  // video
  'video/mp4': (b) => isIsoBmff(b),
  'video/quicktime': (b) => isIsoBmff(b),
  'video/webm': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  'video/x-matroska': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  'video/x-msvideo': (b) => isRiff(b, [0x41, 0x56, 0x49, 0x20]), // "AVI "
  // office / archives — DOCX, PPTX, XLSX and plain ZIP are all the same
  // "PK" zip container at the byte level, so they share one detector; the
  // legacy binary Office formats (.doc/.xls/.ppt) share the OLE header.
  'application/zip': (b) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(b, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(b, [0x50, 0x4b, 0x07, 0x08]),
  'application/x-cfb': (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};

const CATEGORY_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
  pdf: ['application/pdf'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'],
  video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo'],
  // Word/Excel/PowerPoint (old and new format) plus plain .zip bundles.
  office: ['application/zip', 'application/x-cfb'],
};

/**
 * Returns the detected canonical mime type from the buffer's magic bytes, or
 * null if it matches nothing we recognise.
 */
export const detectMimeType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  for (const [type, test] of Object.entries(detectors)) {
    try {
      if (test(buffer)) return type;
    } catch {
      /* ignore malformed */
    }
  }
  return null;
};

/**
 * Throws an Error (message safe to surface) if the buffer's real content isn't
 * one of the allowed categories. Returns the detected mime type on success.
 *
 * @param {Buffer} buffer
 * @param {string[]} categories - any of 'image' | 'pdf' | 'audio' | 'video'
 */
export const assertAllowedUpload = (buffer, categories) => {
  const allowedTypes = new Set(categories.flatMap((c) => CATEGORY_TYPES[c] || []));
  const detected = detectMimeType(buffer);
  if (!detected || !allowedTypes.has(detected)) {
    const label = categories.join(', ');
    throw new Error(
      `File content does not match an allowed type (${label}). The file may be corrupt or disguised.`,
    );
  }
  return detected;
};
