import mongoose from 'mongoose';

/** DoctorAvailability — structured schedule slots for doctors. */
const doctorAvailabilitySchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true,
      index: true,
    },
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    }, // 0 = Sunday
    startTime: { type: String, required: true, trim: true }, // 'HH:MM'
    endTime: { type: String, required: true, trim: true }, // 'HH:MM'
    // IANA zone the HH:MM times are in (e.g. "Asia/Kolkata"); see utils/timezone.js.
    timezone: { type: String, trim: true, default: 'Asia/Kolkata' },
    isAvailable: { type: Boolean, default: true },
    maxSlots: { type: Number, default: 4, min: 1 },
  },
  { timestamps: true },
);

doctorAvailabilitySchema.index({ doctorId: 1, dayOfWeek: 1 });

export default mongoose.model('DoctorAvailability', doctorAvailabilitySchema);
