import User from '../models/User.js';

/**
 * Where a user's pushes go: the phone (`notificationToken`, one per user, the
 * app's native FCM/APNs token) plus any browsers that turned on web push
 * (`webPushTokens`, the web app / PWA). Kept apart so registering one never
 * replaces the other.
 */

/** Browsers per account that keep getting pushes; the oldest drops off. */
export const MAX_WEB_PUSH_TOKENS = 5;

/** Every device token of a user (lean doc or model), deduped, phone first. */
export const pushTokensOf = (user) => {
  if (!user) return [];
  const tokens = [
    user.notificationToken,
    ...(Array.isArray(user.webPushTokens) ? user.webPushTokens : []),
  ];
  return [...new Set(tokens.filter((t) => typeof t === 'string' && t))];
};

/** Mongo filter: users with at least one device token. */
export const HAS_PUSH_TOKEN = {
  $or: [{ notificationToken: { $nin: [null, ''] } }, { 'webPushTokens.0': { $exists: true } }],
};

/** `platform: "web"` in the register body means a browser token. */
export const isWebTokenRequest = (body) =>
  Boolean(body) && typeof body === 'object' && body.platform === 'web';

/**
 * Drops tokens FCM reported dead (uninstalled app, revoked browser
 * permission, rotated token) from every user that has them.
 */
export const pruneDeadTokens = async (tokens) => {
  const dead = [...new Set((tokens || []).filter(Boolean))];
  if (dead.length === 0) return;
  await Promise.all([
    User.updateMany({ notificationToken: { $in: dead } }, { $unset: { notificationToken: 1 } }),
    User.updateMany({ webPushTokens: { $in: dead } }, { $pull: { webPushTokens: { $in: dead } } }),
  ]);
};

/**
 * Registers a browser token for this user: removes it from any other account
 * (one browser profile = one person), then appends it, keeping the newest
 * MAX_WEB_PUSH_TOKENS.
 */
export const addWebPushToken = async (userId, token) => {
  await User.updateMany(
    { _id: { $ne: userId }, webPushTokens: token },
    { $pull: { webPushTokens: token } },
  );
  await User.updateOne({ _id: userId }, { $pull: { webPushTokens: token } });
  return User.findByIdAndUpdate(
    userId,
    { $push: { webPushTokens: { $each: [token], $slice: -MAX_WEB_PUSH_TOKENS } } },
    { new: true },
  );
};
