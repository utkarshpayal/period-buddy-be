// FCM registration tokens are ~150-200 chars; anything far beyond that can't
// be a token we stored, so it's never worth sending to Mongo as a filter.
export const MAX_FCM_TOKEN_LENGTH = 4096;

/**
 * Build the User filter for clearing the push token on logout.
 *
 * `notificationToken` is a single field per user, so it holds whichever
 * device registered last. Newer app builds send the logging-out device's own
 * token, and we only clear the field if it still belongs to that device —
 * otherwise logging out on phone A would silence phone B.
 *
 * Returns:
 *  - `{ _id, notificationToken }` when a usable token was sent (conditional unset)
 *  - `{ _id }` when no token was sent, i.e. older app builds (unconditional
 *    unset, the pre-existing behaviour)
 *  - `null` when a string was sent but is too long to be a real token: skip
 *    the update rather than falling back to wiping another device's token.
 */
export function buildLogoutTokenFilter(userId, body) {
  const raw = body && typeof body === 'object' ? body.fcmToken : undefined;
  if (typeof raw !== 'string') return { _id: userId };
  const token = raw.trim();
  if (!token) return { _id: userId };
  if (token.length > MAX_FCM_TOKEN_LENGTH) return null;
  return { _id: userId, notificationToken: token };
}
