import express from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authMiddleware.js';
import * as documentController from '../controllers/documentController.js';
import { requireAiConsent } from '../utils/privacy.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — scanned multi-page PDFs run larger than photos
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
      return cb(new Error('Only image or PDF uploads are supported'));
    }
    cb(null, true);
  },
});

router.use(authenticate);

// Registered ahead of the /:id route so "chat"/"summarize" are never
// swallowed as a document id. Upload + chat are gated behind
// 'document_chat' via the global feature-route registry
// (config/subscriptionRouteRegistry.js) — free until an admin marks it
// premium; browsing/deleting documents you already uploaded stays free.
router.get('/chat', documentController.getChatHistory);
router.post('/chat', requireAiConsent, documentController.sendChatMessage);
router.post('/summarize', requireAiConsent, documentController.summarizeDocuments);

router.post('/', upload.single('file'), documentController.uploadDocument);
router.get('/', documentController.listDocuments);
router.get('/:id', documentController.getDocument);
router.delete('/:id', documentController.deleteDocument);

export default router;
