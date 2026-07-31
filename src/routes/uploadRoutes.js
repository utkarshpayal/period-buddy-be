import express from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authMiddleware.js';
import { uploadFile } from '../controllers/uploadController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (covers community photo/video/audio attachments)
  fileFilter: (req, file, cb) => {
    const isSupported = ['image/', 'video/', 'audio/'].some((prefix) =>
      file.mimetype.startsWith(prefix),
    );
    if (!isSupported) {
      return cb(new Error('Only image, video, or audio uploads are supported'));
    }
    cb(null, true);
  },
});

/**
 * @route   POST /api/upload
 * @desc    Upload a file (profile picture, community post image/video/audio, etc.) to S3
 * @access  Private
 */
router.post('/', authenticate, upload.single('file'), uploadFile);

export default router;
