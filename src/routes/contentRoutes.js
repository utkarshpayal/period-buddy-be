import express from 'express';
import * as contentController from '../controllers/contentController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/', contentController.listContent);
router.get('/types', contentController.getContentTypes);
router.get('/summary', contentController.getContentSummary);
router.post('/:type', contentController.createContent);
router.get('/:type/:id', contentController.getContentById);
router.put('/:type/:id', contentController.updateContent);
router.patch('/:type/:id/publish', contentController.setContentVisibility);
router.delete('/:type/:id', contentController.deleteContent);

export default router;
