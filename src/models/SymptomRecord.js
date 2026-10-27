import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';
import {
  BODY_REGION_IDS,
  CUSTOM_NAME_MAX,
  FREQUENCIES,
  NOTE_MAX,
  SEVERITY_MAX,
  SEVERITY_MIN,
  SIDES,
  STATUSES,
} from '../utils/symptomRecord.js';

/**
 * A symptom the person placed on the app's Body Map (self-reported, never a
 * diagnosis). Input rules live in utils/symptomRecord.js.
 */
const symptomRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Stable slug (the app's day-log tags like `cramps`, or `other`).
    symptomKey: { type: String, required: true, trim: true, maxlength: 40 },
    // The person's own name for an `other` symptom.
    customName: { type: String, trim: true, maxlength: CUSTOM_NAME_MAX, default: '' },
    regionId: { type: String, required: true, enum: BODY_REGION_IDS },
    side: { type: String, required: true, enum: SIDES },
    severity: { type: Number, required: true, min: SEVERITY_MIN, max: SEVERITY_MAX },
    status: { type: String, enum: STATUSES, default: 'active' },
    onsetDate: { type: String, required: true }, // 'YYYY-MM-DD'
    resolvedDate: { type: String, default: null }, // 'YYYY-MM-DD'
    frequency: { type: String, enum: [...FREQUENCIES, null], default: null },
    associatedSymptoms: [{ type: String, trim: true, maxlength: 40 }],
    note: { type: String, trim: true, maxlength: NOTE_MAX, default: '' },
  },
  { timestamps: true },
);

symptomRecordSchema.index({ userId: 1, onsetDate: -1 });

// Free text is encrypted at rest (utils/fieldEncryption.js).
symptomRecordSchema.plugin(encryptFields, { fields: ['note', 'customName'] });

export default mongoose.model('SymptomRecord', symptomRecordSchema);
