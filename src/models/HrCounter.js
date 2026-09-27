import mongoose from 'mongoose';

/** HrCounter — per-series, per-year sequence for document numbers (NC/INT/2026/0007). */
const hrCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export default mongoose.model('HrCounter', hrCounterSchema);
