import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

const screeningAssessmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    condition: {
      type: String,
      enum: ['pcos', 'endometriosis', 'fibroid', 'thyroid'],
      required: true,
    },
    // { [questionId]: answer }, stored as encrypted JSON (older rows: a plain
    // object, read as is until encryptExistingData.js rewrites them).
    answers: { type: mongoose.Schema.Types.Mixed, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: { type: String, enum: ['low', 'moderate', 'high'], required: true },
    summary: { type: String, required: true },
    doctorDiscussionSummary: { type: String, required: true },
  },
  { timestamps: true },
);

screeningAssessmentSchema.index({ userId: 1, createdAt: -1 });

// Free text and the answers are encrypted at rest (utils/fieldEncryption.js).
screeningAssessmentSchema.plugin(encryptFields, {
  fields: ['summary', 'doctorDiscussionSummary'],
  json: ['answers'],
});

export default mongoose.model('ScreeningAssessment', screeningAssessmentSchema);
