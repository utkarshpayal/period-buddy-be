import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import * as companyFolderController from '../controllers/companyFolderController.js';

const router = express.Router();

router.use(authenticate, authorize('admin'));

/**
 * @route   GET /api/company-folders?parentId=
 * @desc    Subfolders of a folder (root when parentId is omitted), with
 *          item counts and a breadcrumb path
 * @access  Admin
 */
router.get('/', companyFolderController.listFolders);

/**
 * @route   POST /api/company-folders
 * @desc    Create a folder
 * @access  Admin
 */
router.post('/', companyFolderController.createFolder);

/**
 * @route   PATCH /api/company-folders/:id
 * @desc    Rename and/or move a folder
 * @access  Admin
 */
router.patch('/:id', companyFolderController.updateFolder);

/**
 * @route   DELETE /api/company-folders/:id
 * @desc    Delete a folder, its subfolders, and everything inside them
 * @access  Admin
 */
router.delete('/:id', companyFolderController.deleteFolder);

export default router;
