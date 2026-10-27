import mongoose from 'mongoose';

/**
 * The Wellness Forest care game's state, one per person (rules in
 * utils/garden.js). Saved with optimistic concurrency: two care actions at
 * once can't overwrite each other (the controller retries the loser).
 */
const spotSchema = new mongoose.Schema({ id: Number, x: Number, z: Number }, { _id: false });
const leafSchema = new mongoose.Schema({ id: Number, leaf: Number }, { _id: false });

const forestGardenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    tick: { type: Number, required: true },
    moisture: { type: Number, default: 70 },
    nutrients: { type: Number, default: 70 },
    health: { type: Number, default: 80 },
    soggyUntil: { type: Number, default: 0 },
    mulchUntil: { type: Number, default: 0 },
    weeds: [spotSchema],
    pests: [leafSchema],
    deadLeaves: [leafSchema],
    nextId: { type: Number, default: 1 },
    compost: { type: Number, default: 1 },
    mulch: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    xpDay: { type: String, default: '' },
    xpToday: { type: Number, default: 0 },
    waterXpToday: { type: Number, default: 0 },
    // Supplies are granted for day logs / habit days after this day key.
    suppliesGrantedThrough: { type: String, default: '' },
  },
  { timestamps: true, optimisticConcurrency: true },
);

export default mongoose.model('ForestGarden', forestGardenSchema);
