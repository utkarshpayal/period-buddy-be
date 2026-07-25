import express from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authMiddleware.js';
import * as speechController from '../controllers/speechController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — a few minutes of recorded voice audio
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('audio/') && file.mimetype !== 'video/mp4') {
      // Some recorders (notably iOS Safari/WebKit) tag .m4a voice recordings as video/mp4.
      return cb(new Error('Only audio uploads are supported'));
    }
    cb(null, true);
  },
});

router.use(authenticate);

router.get('/languages', speechController.getLanguages);
router.post('/transcribe', upload.single('file'), speechController.transcribeAudio);
router.post('/synthesize', speechController.synthesizeSpeech);

export default router;
