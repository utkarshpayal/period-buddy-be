/**
 * Optional in-app destination for a push notification, sent as FCM
 * `data.route` and read by the app's notification tap handler
 * (The-Nura-App/app/_layout.tsx). It must be a plain in-app path such as
 * "/tracker" or "/blogs?slug=abc" — never a full URL — so a compromised or
 * mistyped admin input can't turn a notification tap into an external link.
 * The app re-validates the same shape before navigating.
 */
export const NOTIFICATION_ROUTE_MAX = 200;

const ROUTE_PATTERN = /^\/[A-Za-z0-9\-_/()]*(\?[A-Za-z0-9\-_=&%.~+]*)?$/;

export const isValidNotificationRoute = (value) =>
  typeof value === 'string' &&
  value.length <= NOTIFICATION_ROUTE_MAX &&
  !value.startsWith('//') &&
  !value.includes('..') &&
  ROUTE_PATTERN.test(value);

/**
 * @returns {{ route?: string, error?: string }} `{}` when no route was given.
 */
export const parseNotificationRoute = (value) => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { error: 'Route must be a string' };
  const route = value.trim();
  if (!route) return {};
  if (!isValidNotificationRoute(route)) {
    return { error: 'Route must be an in-app path like "/tracker" (no full URLs)' };
  }
  return { route };
};
