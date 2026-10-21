/**
 * ALLOWED_ORIGINS (comma-separated) for CORS and the cookie CSRF check.
 * Entries are exact origins ("https://admin.thenura.care"), "*" for any
 * origin, or a subdomain pattern "https://*.thenura.care", which matches any
 * subdomain at any depth over that scheme and default port, but not the bare
 * domain itself.
 */

/** "a, b,,c" → ["a", "b", "c"]. */
export const parseAllowedOrigins = (raw = process.env.ALLOWED_ORIGINS) =>
  String(raw || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

const matchesPattern = (origin, pattern) => {
  const [scheme, host] = pattern.split('://*.');
  if (!scheme || !host) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (
    url.protocol === `${scheme}:` &&
    url.port === '' &&
    url.hostname.endsWith(`.${host.toLowerCase()}`)
  );
};

/**
 * Whether a browser Origin header is on the allowlist. `allowAny: false`
 * ignores a bare "*" (the cookie CSRF check never trusted it).
 */
export const isOriginAllowed = (
  origin,
  allowed = parseAllowedOrigins(),
  { allowAny = true } = {},
) => {
  if (!origin) return false;
  return allowed.some(
    (entry) =>
      (entry === '*' && allowAny) ||
      entry === origin ||
      (entry.includes('://*.') && matchesPattern(origin, entry)),
  );
};
