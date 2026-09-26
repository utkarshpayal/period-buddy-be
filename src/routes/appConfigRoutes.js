import express from 'express';
import * as appConfigController from '../controllers/appConfigController.js';

const router = express.Router();

/**
 * @route   GET /api/app-config
 * @desc    App layout managed from the App CMS: feature tiles and admin link tiles (hub, order, size, colour, text, badge, audience), home sections, theme colour overrides, app settings (maintenance mode, update prompts) and live promo banners. Sent with Cache-Control: no-cache (ETag revalidation)
 * @access  Public
 */
router.get('/', appConfigController.getAppConfig);

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

export default router;
