import mongoose from 'mongoose';

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
    answers: { type: Map, of: mongoose.Schema.Types.Mixed, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: { type: String, enum: ['low', 'moderate', 'high'], required: true },
    summary: { type: String, required: true },
    doctorDiscussionSummary: { type: String, required: true },
  },
  { timestamps: true },
);

screeningAssessmentSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('ScreeningAssessment', screeningAssessmentSchema);
