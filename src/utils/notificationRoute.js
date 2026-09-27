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

/**
 * Icons an admin can give a push. The app draws them in its notification
 * list (Ionicons glyph names), so this list must match
 * The-Nura-App/lib/notificationIcons.ts; anything else falls back to the
 * type's default icon.
 */
export const NOTIFICATION_ICONS = [
  'megaphone',
  'sparkles',
  'gift',
  'pricetag',
  'heart',
  'flower',
  'water',
  'moon',
  'calendar',
  'alarm',
  'medkit',
  'fitness',
  'leaf',
  'cafe',
  'book',
  'play-circle',
  'chatbubble-ellipses',
  'people',
  'trophy',
  'star',
  'flame',
  'shield-checkmark',
];

export const NOTIFICATION_IMAGE_MAX = 1000;

/**
 * Optional look of a push: `icon` (one of NOTIFICATION_ICONS) and `image`
 * (https URL, shown as the big picture on Android and as a banner in the
 * app's list). Blank values mean "not set".
 * @returns {{ extras: { icon?: string, image?: string }, error?: string }}
 */
export const parseNotificationExtras = ({ icon, image } = {}) => {
  const extras = {};
  if (icon !== undefined && icon !== null && icon !== '') {
    if (!NOTIFICATION_ICONS.includes(icon)) return { error: 'Pick an icon from the list' };
    extras.icon = icon;
  }
  if (image !== undefined && image !== null && String(image).trim() !== '') {
    const url = String(image).trim();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { error: 'Image must be a link like https://…' };
    }
    if (parsed.protocol !== 'https:') return { error: 'Image link must start with https://' };
    if (url.length > NOTIFICATION_IMAGE_MAX) return { error: 'Image link is too long' };
    extras.image = url;
  }
  return { extras };
};

/**
 * The FCM data payload an admin send carries: route, icon and image, each
 * only when set. `{ data }` (undefined when empty) or `{ error }`.
 */
export const parseNotificationData = (body = {}) => {
  const parsedRoute = parseNotificationRoute(body.route);
  if (parsedRoute.error) return { error: parsedRoute.error };
  const { extras, error } = parseNotificationExtras(body);
  if (error) return { error };
  const data = { ...(parsedRoute.route && { route: parsedRoute.route }), ...extras };
  return { data: Object.keys(data).length ? data : undefined };
};
