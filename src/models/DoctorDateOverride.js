import mongoose from 'mongoose';

/**
 * DoctorDateOverride — a doctor's hours on one calendar date, replacing that
 * weekday's DoctorAvailability ranges. No ranges means the day is off
 * (leave, a holiday, a conference). `date` is "YYYY-MM-DD" in `timezone`.
 */
const rangeSchema = new mongoose.Schema(
  {
    startTime: { type: String, required: true, trim: true }, // 'HH:MM'
    endTime: { type: String, required: true, trim: true }, // 'HH:MM'
    maxSlots: { type: Number, required: true, min: 1 },
    slotMinutes: { type: Number, min: 10, max: 240 },
  },
  { _id: false },
);

const doctorDateOverrideSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    date: { type: String, required: true, trim: true },
    ranges: { type: [rangeSchema], default: [] },
    timezone: { type: String, trim: true, default: 'Asia/Kolkata' },
    /** Doctor's own label, e.g. "Conference" (shown only in the portal). */
    note: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true },
);

doctorDateOverrideSchema.index({ doctorId: 1, date: 1 }, { unique: true });

export default mongoose.model('DoctorDateOverride', doctorDateOverrideSchema);
