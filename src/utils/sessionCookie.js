import { isStaffRole } from '../config/permissions.js';
import { isOriginAllowed } from './allowedOrigins.js';
import { decodeToken } from './jwt.js';

/**
 * Staff sign-in in an httpOnly cookie (Admin Workspace and CMS), so a
 * cross-site-scripting bug in those sites can't read the session token out
 * of localStorage.
 *
 * - On when STAFF_COOKIE_AUTH=true, and only for a staff login that asks for
 *   it with `X-Session-Mode: cookie`. Everyone else (the app, doctors, older
 *   workspace builds) keeps using the Bearer token exactly as before.
 * - The cookie is `HttpOnly; Secure; SameSite=Strict`, so the browser sends
 *   it only on requests made from our own sites (same site: *.thenura.care).
 *   The sites keep `credentials: "include"` on their requests.
 * - CSRF: a request authenticated by the cookie that changes something
 *   (anything but GET/HEAD/OPTIONS) must come from an allowed Origin
 *   (ALLOWED_ORIGINS in production). Browsers always send Origin on those.
 * - A Bearer header, when present, wins over the cookie.
 */

export const SESSION_COOKIE = 'nura_staff_session';

export const cookieAuthEnabled = () => process.env.STAFF_COOKIE_AUTH === 'true';

/** Should this login's session go into a cookie? */
export const wantsCookieSession = (req, user) =>
  cookieAuthEnabled() && isStaffRole(user?.role) && req?.get?.('X-Session-Mode') === 'cookie';

/** The value of one cookie from the Cookie header, or null. */
export const readCookie = (req, name = SESSION_COOKIE) => {
  const header = req?.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
};

const baseOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api',
});

export const setSessionCookie = (res, token) => {
  const { exp } = decodeToken(token) || {};
  res.cookie(SESSION_COOKIE, token, {
    ...baseOptions(),
    ...(exp && { expires: new Date(exp * 1000) }),
  });
};

export const clearSessionCookie = (res) => res.clearCookie(SESSION_COOKIE, baseOptions());

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF check for a cookie-authenticated request (see above). */
export const cookieRequestAllowed = (req) => {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = req.get('Origin');
  if (!origin) return false;
  if (process.env.NODE_ENV !== 'production') return true;
  return isOriginAllowed(origin, undefined, { allowAny: false });
};

/**
 * The token for this request and where it came from: `{ token, fromCookie }`.
 * The cookie is only read while STAFF_COOKIE_AUTH is on.
 */
export const tokenFromRequest = (req) => {
  const [scheme, token] = req.headers.authorization?.split(' ') || [];
  if (scheme === 'Bearer' && token) return { token, fromCookie: false };
  if (!cookieAuthEnabled()) return { token: null, fromCookie: false };
  const cookie = readCookie(req);
  return cookie ? { token: cookie, fromCookie: true } : { token: null, fromCookie: false };
};
