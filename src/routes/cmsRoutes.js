import express from 'express';
import multer from 'multer';
import * as appConfigController from '../controllers/appConfigController.js';
import * as genzController from '../controllers/genzController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission, requireStaff } from '../middleware/rbac.js';
import { PERMISSIONS as P } from '../config/permissions.js';

// Admin API for The-Nura-CMS portal. Reading needs cms.read (App Admins and
// up); every change needs cms.manage (App Super Admin, Super Admin). Changes
// go live in the app on its next config fetch (≤ a few minutes), no deploy.
const router = express.Router();
router.use(authenticate, requireStaff);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Only image uploads are supported')),
});

/**
 * @route   GET /api/cms/config
 * @desc    Editable app config (features with their defaults, home sections, theme overrides) plus the catalog of placements, colours and default theme values
 * @access  Private (cms.read)
 */
router.get('/config', requirePermission(P.CMS_READ), appConfigController.getCmsConfig);
/**
 * @route   PUT /api/cms/features
 * @desc    Save the full feature list and admin link tiles. Body: { features: [{ key, enabled, placement, order, size, colorKey, title?, description?, badge?, audience? }], customTiles?: [{ id?, title, description?, icon, colorKey, placement, size, order, enabled, badge?, action: { type: route|url|app, value, fallbackUrl? }, audience? }], version? } — version (this section's) guards against overwriting a newer save (409)
 * @access  Private (cms.manage)
 */
router.put('/features', requirePermission(P.CMS_MANAGE), appConfigController.updateFeatures);
/**
 * @route   PUT /api/cms/home
 * @desc    Save home screen section visibility and order. Body: { homeSections: [{ key, visible, order }], version? }
 * @access  Private (cms.manage)
 */
router.put('/home', requirePermission(P.CMS_MANAGE), appConfigController.updateHomeSections);
/**
 * @route   PUT /api/cms/theme
 * @desc    Save theme colour overrides. Body: { theme: { light: { token: color }, dark: { token: color } }, version? }; an empty value restores the app default
 * @access  Private (cms.manage)
 */
router.put('/theme', requirePermission(P.CMS_MANAGE), appConfigController.updateTheme);

/**
 * @route   PUT /api/cms/settings
 * @desc    Save app settings. Body: { settings: { maintenance: { enabled, title, message }, update: { minVersion, latestVersion, title, message, androidUrl, iosUrl } }, version? }
 * @access  Private (cms.manage)
 */
router.put('/settings', requirePermission(P.CMS_MANAGE), appConfigController.updateSettings);

/**
 * @route   GET /api/cms/revisions
 * @desc    Publish history, newest first. Query: section (features | homeSections | theme | settings)
 * @access  Private (cms.read)
 */
router.get('/revisions', requirePermission(P.CMS_READ), appConfigController.listRevisions);
/**
 * @route   POST /api/cms/revisions/:id/restore
 * @desc    Republish a past revision of its section as the current state
 * @access  Private (cms.manage)
 */
router.post(
  '/revisions/:id/restore',
  requirePermission(P.CMS_MANAGE),
  appConfigController.restoreRevision,
);

/**
 * @route   GET /api/cms/banners
 * @desc    Every promo banner with its status (live, scheduled, expired, inactive) and click count
 * @access  Private (cms.read)
 */
router.get('/banners', requirePermission(P.CMS_READ), appConfigController.listBanners);
/**
 * @route   POST /api/cms/banners
 * @desc    Create a promo banner. Body: { title, subtitle?, ctaLabel?, imageUrl?, placement, layout, action: { type: none|route|url, value }, backgroundColor?, textColor?, priority?, active?, dismissible?, startAt?, endAt? }
 * @access  Private (cms.manage)
 */
router.post('/banners', requirePermission(P.CMS_MANAGE), appConfigController.createBanner);
/**
 * @route   PUT /api/cms/banners/:id
 * @desc    Replace a banner's editable fields (same body as create)
 * @access  Private (cms.manage)
 */
router.put('/banners/:id', requirePermission(P.CMS_MANAGE), appConfigController.updateBanner);
/**
 * @route   DELETE /api/cms/banners/:id
 * @desc    Delete a banner
 * @access  Private (cms.manage)
 */
router.delete('/banners/:id', requirePermission(P.CMS_MANAGE), appConfigController.deleteBanner);
/**
 * @route   POST /api/cms/upload
 * @desc    Upload a banner image (multipart field "file", images up to 5MB) to S3 under cms/banners/. Returns { url, key }
 * @access  Private (cms.manage)
 */
router.post(
  '/upload',
  requirePermission(P.CMS_MANAGE),
  imageUpload.single('file'),
  appConfigController.uploadCmsImage,
);

/**
 * @route   GET /api/cms/cycle-sync-tips
 * @desc    Phase Era cycle-syncing tips (the built-in defaults while none are saved, flagged usingDefaults), plus phases, categories and era definitions
 * @access  Private (cms.read)
 */
router.get('/cycle-sync-tips', requirePermission(P.CMS_READ), genzController.listTips);
/**
 * @route   POST /api/cms/cycle-sync-tips/seed
 * @desc    Copy the built-in default tips into the database so they can be edited (409 once tips are saved)
 * @access  Private (cms.manage)
 */
router.post('/cycle-sync-tips/seed', requirePermission(P.CMS_MANAGE), genzController.seedTips);
/**
 * @route   POST /api/cms/cycle-sync-tips
 * @desc    Add a tip. Body: { phase, category: move|fuel|selfCare|vibe, title, body?, emoji?, active?, order? }. The first one also copies the defaults in
 * @access  Private (cms.manage)
 */
router.post('/cycle-sync-tips', requirePermission(P.CMS_MANAGE), genzController.createTip);
/**
 * @route   PUT /api/cms/cycle-sync-tips/:id
 * @desc    Replace a tip (same body as create)
 * @access  Private (cms.manage)
 */
router.put('/cycle-sync-tips/:id', requirePermission(P.CMS_MANAGE), genzController.updateTip);
/**
 * @route   DELETE /api/cms/cycle-sync-tips/:id
 * @desc    Delete a tip
 * @access  Private (cms.manage)
 */
router.delete('/cycle-sync-tips/:id', requirePermission(P.CMS_MANAGE), genzController.deleteTip);

export default router;
