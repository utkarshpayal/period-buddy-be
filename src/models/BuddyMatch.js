import mongoose from 'mongoose';

/**
 * BuddyMatch — ONE canonical document per pairing, shared by both participants.
 *
 * Historically this stored two reciprocal rows (one per user, each pointing at
 * the other), which meant every pairing was two DB entries and every message
 * was written four times. This model collapses that into a single row keyed by
 * `members` (the two participant ids, stored sorted so a pair maps to exactly
 * one document regardless of who initiated). The per-user "buddy card" (the
 * counterpart's name/avatar/phase/compatibility) is projected at read time from
 * live data instead of being frozen into two divergent copies.
 *
 * Ending a pairing hard-deletes this row and its BuddyMessage history — a
 * buddy space is disposable and private by design — so `status` exists only as
 * a defensive default; a persisted row is always an active pairing.
 */
const buddyMatchSchema = new mongoose.Schema(
  {
    // Exactly two participant user ids, stored sorted (ascending by hex string)
    // so both sides resolve to the same single document and the unique index
    // below can enforce one pairing per pair.
    members: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2,
        message: 'A buddy pairing must have exactly two members',
      },
    },

    // Deterministic "<smallerId>_<largerId>" key for the pair. A plain scalar
    // unique index on this is the hard guarantee that a given pair can only ever
    // have ONE document — even under concurrent nominate requests — which is
    // what keeps the collection at one row per pairing at any scale.
    pairKey: { type: String, required: true, unique: true, trim: true },

    // Unique per pairing; scopes the buddy_<roomKey> WebSocket room to this
    // pairing so it can never collide with a past or future one.
    roomKey: { type: String, required: true, unique: true, trim: true },

    // Symmetric match metadata, computed once at pairing time (the live card
    // recomputes freshness on read, but this is the snapshot at match time).
    compatibility: { type: Number, min: 0, max: 100, default: 80 },
    cycleOverlapDays: { type: Number, default: 0 },
    similarities: [{ type: String, trim: true }],

    status: {
      type: String,
      enum: ['active', 'ended'],
      default: 'active',
      index: true,
    },

    // Messaging summary for list/preview rendering.
    lastMessage: { type: String, trim: true },
    lastMessageAt: { type: Date },

    // Per-member read cursor. unreadCount is derived by counting messages after
    // a member's lastReadAt that they didn't send — no denormalized counter to
    // drift out of sync.
    reads: {
      type: [
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          lastReadAt: { type: Date, default: null },
        },
      ],
      default: [],
    },

    nominatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    nominatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Fast "my active buddy" lookup (multikey over the two member ids). Not unique
// — the unique guarantee lives on the scalar `pairKey` above, whose semantics
// are unambiguous (a unique index on an array field has surprising multikey
// behaviour we deliberately avoid relying on).
buddyMatchSchema.index({ members: 1, status: 1 });

export default mongoose.model('BuddyMatch', buddyMatchSchema);
