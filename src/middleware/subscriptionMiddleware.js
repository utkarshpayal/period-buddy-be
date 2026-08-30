import { HTTP_STATUS } from '../constants/httpStatus.js';
import { hasFeatureAccess, getFeatureLockPayload } from '../utils/subscriptionAccess.js';
import { FEATURE_ROUTES } from '../config/subscriptionRouteRegistry.js';
import { authenticate } from './authMiddleware.js';
import logger from '../utils/logger.js';

/**
 * Gate a route behind a SubscriptionFeature key. Must run after
 * `authenticate` (reads req.userId). Free/unknown/inactive features and a
 * globally-disabled subscription system all pass through untouched — see
 * subscriptionAccess.js#hasFeatureAccess for the exact rules — so adding
 * this to a route is safe before any admin has configured pricing.
 *
 * On a lock, responds 402 with a body the mobile paywall can render
 * directly (see getFeatureLockPayload), instead of a bare error string.
 */
export const requireFeatureAccess = (featureKey) => async (req, res, next) => {
  try {
    const allowed = await hasFeatureAccess(req.userId, featureKey);
    if (allowed) return next();

    const payload = await getFeatureLockPayload(featureKey);
    logger.info('feature_access_blocked', {
      action: 'feature_access_blocked',
      userId: req.userId,
      featureKey,
    });
    return res.status(HTTP_STATUS.PAYMENT_REQUIRED).json({
      success: false,
      statusCode: HTTP_STATUS.PAYMENT_REQUIRED,
      message: `${payload.feature.name} is a premium feature`,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mounted once, globally, ahead of every domain router (see index.js) — for
 * every request, checks `FEATURE_ROUTES` (subscriptionRouteRegistry.js) for
 * a matching method+path and, only when one exists, runs `authenticate`
 * followed by `requireFeatureAccess(key)` before letting the request reach
 * its real route handler. Every other request (the overwhelming majority)
 * is a single array scan and falls straight through — no auth/DB cost.
 *
 * This is what makes a new premium feature "just work" end-to-end: add one
 * entry to the registry (plus a SubscriptionFeature catalog row so it's
 * priceable in the admin Features tab), and it's enforced everywhere the
 * matched route is called, with no changes to the route file itself.
 *
 * Runs `authenticate` itself (rather than relying on the route's own copy,
 * which hasn't run yet at this point in the middleware chain) only for
 * requests that actually match a registered feature — an unauthenticated
 * request to a *gated* route still 401s here exactly as it would have from
 * the route's own `authenticate`, just slightly earlier. The route's own
 * `authenticate` still runs afterward as normal (harmless, not skipped) for
 * whatever else that handler needs from `req.user`.
 */
export const globalFeatureGate = (req, res, next) => {
  const hit = FEATURE_ROUTES.find((r) => r.method === req.method && r.path.test(req.path));
  if (!hit) return next();
  authenticate(req, res, () => requireFeatureAccess(hit.key)(req, res, next));
};
