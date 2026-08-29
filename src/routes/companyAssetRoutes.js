import express from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import * as companyAssetController from '../controllers/companyAssetController.js';

const router = express.Router();

// The public listing is meant for our own site only, not any page on the
// internet — the app-wide ALLOWED_ORIGINS allowlist (index.js) is broader
// than that (mobile web views, marketing pages, etc.), so this route enforces
// its own narrower origin. Defaults to the admin app's own origin; set
// COMPANY_ASSETS_PUBLIC_ORIGIN to point this at whichever site actually
// renders the public file library instead.
const publicAssetsOrigin = (
  process.env.COMPANY_ASSETS_PUBLIC_ORIGIN ||
  process.env.ADMIN_APP_URL ||
  ''
).replace(/\/+$/, '');

// The app-wide `cors()` middleware in index.js runs before this router and
// already stamps an Access-Control-Allow-Origin header onto every request
// whose Origin is in the broader ALLOWED_ORIGINS list. Layering a second
// `cors()` call wouldn't narrow that: it doesn't strip a header a prior
// middleware already set, so any origin already in the broad list would
// still get a browser-readable response here. Setting the header explicitly
// (replacing whatever is already there) is what actually restricts it.
function restrictToPublicAssetsOrigin(req, res, next) {
  const origin = req.headers.origin;
  // Non-browser clients (server-to-server, curl) send no Origin header —
  // CORS is a browser-enforced check, so there's nothing to restrict here.
  if (!origin || process.env.NODE_ENV !== 'production') return next();

  if (publicAssetsOrigin && origin === publicAssetsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return next();
  }

  res.removeHeader('Access-Control-Allow-Origin');
  return next(new Error('Not allowed by CORS'));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB — covers pitch/flow videos, not just decks
  fileFilter: (req, file, cb) => {
    const officeTypes = [
      'application/pdf',
      'application/zip',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];
    const isSupported =
      ['image/', 'video/'].some((prefix) => file.mimetype.startsWith(prefix)) ||
      officeTypes.includes(file.mimetype);
    if (!isSupported) {
      return cb(new Error('Only images, videos, PDFs, or Office documents are supported'));
    }
    cb(null, true);
  },
});

/**
 * @route   GET /api/company-assets/public
 * @desc    Files an admin has marked visible publicly — restricted to our
 *          own site's origin in production (see restrictToPublicAssetsOrigin
 *          above). A plain cross-origin GET like this never triggers a
 *          preflight, so only the actual response's headers need to be right.
 * @access  Public
 */
router.get('/public', restrictToPublicAssetsOrigin, companyAssetController.listPublicAssets);

router.use(authenticate, authorize('admin'));

/**
 * @route   GET /api/company-assets
 * @desc    Full company file library (?search=&category=&isPublic=&page=&limit=)
 * @access  Admin
 */
router.get('/', companyAssetController.listAssets);

/**
 * @route   POST /api/company-assets
 * @desc    Upload a file (pitch deck, flow diagram, brand asset, etc.) to S3
 * @access  Admin
 */
router.post('/', upload.single('file'), companyAssetController.uploadAsset);

/**
 * @route   POST /api/company-assets/link
 * @desc    Add a pointer to something hosted elsewhere (Drive, Figma, Notion,
 *          YouTube, ...) instead of uploading a file
 * @access  Admin
 */
router.post('/link', companyAssetController.createLinkAsset);

/**
 * @route   GET /api/company-assets/:id/download
 * @desc    Short-lived signed S3 URL that forces a real download
 * @access  Admin
 */
router.get('/:id/download', companyAssetController.getDownloadUrl);

/**
 * @route   PATCH /api/company-assets/:id
 * @desc    Edit title/description/category or toggle public visibility
 * @access  Admin
 */
router.patch('/:id', companyAssetController.updateAsset);

/**
 * @route   DELETE /api/company-assets/:id
 * @desc    Delete a file from the library (and from S3)
 * @access  Admin
 */
router.delete('/:id', companyAssetController.deleteAsset);

export default router;
