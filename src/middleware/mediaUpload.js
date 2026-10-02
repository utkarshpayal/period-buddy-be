import path from 'path';
import multer from 'multer';

// Some OSes send an empty or generic `application/octet-stream` mimetype for
// normal media files; fall back to the extension so a real .mp4/.mp3/.jpg
// isn't rejected. Shared by the admin content upload and the doctor upload.
const MIME_TYPE_BY_EXTENSION = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

export const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB — enough for a trimmed reel clip
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype.startsWith('image/')
    ) {
      return cb(null, true);
    }

    const fallbackMimeType = MIME_TYPE_BY_EXTENSION[path.extname(file.originalname).toLowerCase()];
    if (fallbackMimeType) {
      file.mimetype = fallbackMimeType;
      return cb(null, true);
    }

    return cb(new Error('Only video, audio, or image uploads are supported'));
  },
});

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];

/** Profile photos: images only, up to 5 MB. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    const extension = path.extname(file.originalname).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(extension)) {
      file.mimetype = MIME_TYPE_BY_EXTENSION[extension];
      return cb(null, true);
    }
    const error = new Error('Only image uploads are supported');
    error.statusCode = 400;
    return cb(error);
  },
});
