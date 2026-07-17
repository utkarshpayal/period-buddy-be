import express from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authMiddleware.js';
import { uploadFile } from '../controllers/uploadController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are supported'));
    }
    cb(null, true);
  },
});

/**
 * @route   POST /api/upload
 * @desc    Upload an image (profile picture, community post image, etc.) to S3
 * @access  Private
 */
router.post('/', authenticate, upload.single('file'), uploadFile);

export default router;
