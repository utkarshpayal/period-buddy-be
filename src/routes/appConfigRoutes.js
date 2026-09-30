import express from 'express';
import * as appConfigController from '../controllers/appConfigController.js';
import { optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/app-config
 * @desc    App layout managed from the App CMS: feature tiles and admin link tiles (hub, order, size, colour, text, badge, audience, launch state), home sections, theme colour overrides, app settings (maintenance mode, update prompts) and live promo banners. Launch states are resolved for the caller (token and X-Device-Id header); send X-Nura-Launch: 1 to receive them, otherwise anything not plainly open comes back disabled. Sent with Cache-Control: private, no-cache (ETag revalidation)
 * @access  Public (optional auth)
 */
router.get('/', optionalAuth, appConfigController.getAppConfig);

/**
 * @route   POST /api/app-config/banners/:id/click
 * @desc    Count a tap on a promo banner (fire-and-forget beacon from the app)
 * @access  Public
 */
router.post('/banners/:id/click', appConfigController.trackBannerClick);

/**
 * @route   POST /api/app-config/banners/impressions
 * @desc    Count banner views. Body: { ids: [...] } (up to 20), sent once per banner per app session
 * @access  Public
 */
router.post('/banners/impressions', appConfigController.trackBannerImpressions);

/**
 * @route   POST /api/app-config/launch/:itemKey/notify
 * @desc    "Notify me" on a Coming soon feature (itemKey = feature key or link:<tileId>). Signed in it's the account's, else the X-Device-Id header's. Body: { platform? }
 * @access  Public (optional auth)
 */
router.post('/launch/:itemKey/notify', optionalAuth, appConfigController.notifyLaunch);

/**
 * @route   POST /api/app-config/launch/:itemKey/tap
 * @desc    Count a tap on a locked (Coming soon) tile (fire-and-forget beacon from the app)
 * @access  Public
 */
router.post('/launch/:itemKey/tap', appConfigController.trackLockedTap);
/**
 * @route   POST /api/app-config/usage
 * @desc    Batched feature usage beacon from the app. Body: { events: [{ itemKey, kind: open|tap }] } (≤ 50); X-Device-Id header counts unique devices. Unknown items are skipped
 * @access  Public
 */
router.post('/usage', appConfigController.trackUsage);

export default router;
