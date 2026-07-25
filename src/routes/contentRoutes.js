import path from 'path';
import express from 'express';
import multer from 'multer';
import * as contentController from '../controllers/contentController.js';
import { uploadContentMedia } from '../controllers/uploadController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate, authorize('admin'));

// Browsers on some OSes (notably Linux, when the system mime database is
// missing an entry) send an empty or generic `application/octet-stream`
// mimetype for otherwise-normal video/audio/image files. Fall back to the
// file extension in that case so a real .mp4/.mp3/.jpg etc. isn't rejected.
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

// Reel video / guide audio / thumbnail image uploads. Kept admin-only
// (unlike the generic POST /api/upload, which only requires `authenticate`
// for things like profile pictures) since these files feed straight into
// content records.
const mediaUpload = multer({
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
      // Mutate in place — `file` is the same object multer attaches to
      // req.file, so this fallback also becomes the S3 object's Content-Type.
      file.mimetype = fallbackMimeType;
      return cb(null, true);
    }

    return cb(new Error('Only video, audio, or image uploads are supported'));
  },
});

router.get('/', contentController.listContent);
router.get('/types', contentController.getContentTypes);
router.get('/summary', contentController.getContentSummary);
/**
 * @route   POST /api/content/media/upload
 * @desc    Upload a reel video, guide audio, or thumbnail/cover image file
 *          to the `thenura` S3 bucket under `content/<userId>/<folder>`
 *          (folder = 'reels', 'audio', or 'thumbnails' in the request body).
 *          Returns { url, key } for the caller to store as
 *          directMp4Url/audioUrl/imageUrl.
 * @access  Private (admin)
 */
router.post('/media/upload', mediaUpload.single('file'), uploadContentMedia);
router.post('/:type', contentController.createContent);
router.get('/:type/:id', contentController.getContentById);
router.put('/:type/:id', contentController.updateContent);
router.patch('/:type/:id/publish', contentController.setContentVisibility);
router.delete('/:type/:id', contentController.deleteContent);

export default router;
