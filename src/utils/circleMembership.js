import BestieCircle from '../models/BestieCircle.js';
import CircleVibe from '../models/CircleVibe.js';

/**
 * Take `userId` out of a loaded BestieCircle document: the last member leaving
 * deletes it (and its vibes); an owner leaving hands it to the
 * longest-standing member. The user's own vibes in it are removed either way.
 */
export const removeFromCircle = async (circle, userId) => {
  circle.members = circle.members.filter((m) => String(m.userId) !== String(userId));
  if (!circle.members.length) {
    await Promise.all([circle.deleteOne(), CircleVibe.deleteMany({ circleId: circle._id })]);
    return { deleted: true };
  }
  if (String(circle.ownerId) === String(userId)) {
    const next = [...circle.members].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    circle.ownerId = next.userId;
  }
  await Promise.all([circle.save(), CircleVibe.deleteMany({ circleId: circle._id, userId })]);
  return { deleted: false };
};

/** Every circle the user is in (account deletion). Idempotent. */
export const leaveAllCircles = async (userId) => {
  const circles = await BestieCircle.find({ 'members.userId': userId });
  for (const circle of circles) await removeFromCircle(circle, userId);
  await CircleVibe.deleteMany({ userId });
};
