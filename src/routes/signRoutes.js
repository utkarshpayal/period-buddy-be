import express from 'express';
import * as sign from '../controllers/hrSignController.js';

// Public e-signing for HR documents: the link in the email opens
// ADMIN_APP_URL/sign/<token>, which calls these. The token is the only key.
const router = express.Router();

/**
 * @route   GET /api/sign/:token
 * @desc    The document a signing link opens: name, status, recipient, signature box and page sizes. 404 bad link, 410 expired or revoked
 * @access  Public (signing token)
 */
router.get('/:token', sign.getSigning);
/**
 * @route   GET /api/sign/:token/file
 * @desc    The document's PDF (the signed copy once signed), inline
 * @access  Public (signing token)
 */
router.get('/:token/file', sign.getSigningFile);
/**
 * @route   POST /api/sign/:token
 * @desc    Sign it. Body: { signature: PNG data URL (≤ 1 MB), name, agree: true }. 409 if already signed
 * @access  Public (signing token)
 */
router.post('/:token', sign.submitSignature);

export default router;
