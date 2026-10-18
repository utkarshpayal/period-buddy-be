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
 * External store links a push may open instead of an in-app screen (e.g. an
 * "Update the app" push). Only these shapes are allowed, so a push can never
 * open an arbitrary website or a code-running scheme:
 *   https://play.google.com/…   market://…   https://apps.apple.com/…
 * The app re-checks the same allowlist (The-Nura-App/lib/storeLink.ts).
 */
export const STORE_URL_MAX = 500;
export const NOTIFICATION_KINDS = ['app_update'];

export const isAllowedStoreUrl = (value) => {
  if (typeof value !== 'string' || !value || value.length > STORE_URL_MAX) return false;
  if (/\s/.test(value)) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.port) return false;
  if (parsed.protocol === 'market:') return /^market:\/\/[A-Za-z0-9]/.test(value);
  if (parsed.protocol !== 'https:') return false;
  return parsed.hostname === 'play.google.com' || parsed.hostname === 'apps.apple.com';
};

const isIosStoreUrl = (value) =>
  isAllowedStoreUrl(value) && new URL(value).hostname === 'apps.apple.com';

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Optional store link of a push: `storeUrl` (Play Store / market:// / App
 * Store), `iosStoreUrl` (App Store, used on iPhones) and `kind`
 * ('app_update'). With `kind: 'app_update'` and no link given, the App
 * settings' update links (`storeDefaults` = settings.update) are used.
 * @returns {{ link: { kind?: string, storeUrl?: string, iosStoreUrl?: string }, error?: string }}
 */
export const parseNotificationStoreLink = (body = {}, storeDefaults = {}) => {
  const link = {};
  if (!blank(body.kind)) {
    if (!NOTIFICATION_KINDS.includes(body.kind)) return { error: 'Unknown notification kind' };
    link.kind = body.kind;
  }
  for (const [field, check, message] of [
    [
      'storeUrl',
      isAllowedStoreUrl,
      'Store link must be a Play Store (https://play.google.com/… or market://…) or App Store (https://apps.apple.com/…) link',
    ],
    ['iosStoreUrl', isIosStoreUrl, 'iPhone store link must be an https://apps.apple.com/… link'],
  ]) {
    if (blank(body[field])) continue;
    if (typeof body[field] !== 'string') return { error: message };
    const url = body[field].trim();
    if (!check(url)) return { error: message };
    link[field] = url;
  }
  if (link.kind === 'app_update') {
    const android = storeDefaults?.androidUrl;
    const ios = storeDefaults?.iosUrl;
    if (!link.storeUrl && !link.iosStoreUrl) {
      if (isAllowedStoreUrl(android)) link.storeUrl = android;
      if (isIosStoreUrl(ios)) link.iosStoreUrl = ios;
    } else if (!link.iosStoreUrl && link.storeUrl && !isIosStoreUrl(link.storeUrl)) {
      // A Play link was given: still send iPhones to the App Store when known.
      if (isIosStoreUrl(ios)) link.iosStoreUrl = ios;
    }
    if (!link.storeUrl && !link.iosStoreUrl) {
      return {
        error:
          'Add a store link, or set the Play Store / App Store links in App settings → Update prompt',
      };
    }
  }
  if (link.iosStoreUrl && !link.storeUrl) {
    link.storeUrl = link.iosStoreUrl;
  }
  return { link };
};

/** True when a send wants the App settings' store links as its default. */
// An app-update push needs App settings unless it names an App Store link:
// with no link it takes both, with only a Play link it still takes the iOS one.
export const wantsStoreDefaults = (body = {}) =>
  body?.kind === 'app_update' && blank(body.iosStoreUrl);

/**
 * The FCM data payload an admin send carries: route, store link, icon and
 * image, each only when set. A push opens either an in-app screen (`route`)
 * or a store link (`storeUrl`), never both. `storeDefaults` is the App
 * settings' `update` object (androidUrl / iosUrl), used by app-update pushes
 * that don't name a link. `{ data }` (undefined when empty) or `{ error }`.
 */
export const parseNotificationData = (body = {}, storeDefaults = {}) => {
  const parsedRoute = parseNotificationRoute(body.route);
  if (parsedRoute.error) return { error: parsedRoute.error };
  const store = parseNotificationStoreLink(body, storeDefaults);
  if (store.error) return { error: store.error };
  if (parsedRoute.route && store.link.storeUrl) {
    return { error: 'A notification opens either a screen in the app or a store link, not both' };
  }
  const { extras, error } = parseNotificationExtras(body);
  if (error) return { error };
  const data = { ...(parsedRoute.route && { route: parsedRoute.route }), ...store.link, ...extras };
  return { data: Object.keys(data).length ? data : undefined };
};
