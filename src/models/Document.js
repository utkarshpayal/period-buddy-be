import mongoose from 'mongoose';

export const DOCUMENT_TYPES = ['prescription', 'lab_report', 'bill', 'scan', 'other'];
export const EXTRACTION_STATUSES = ['pending', 'done', 'limited', 'failed'];

const documentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    docType: { type: String, enum: DOCUMENT_TYPES, default: 'other', index: true },
    documentDate: { type: Date, required: true, index: true },

    fileUrl: { type: String, required: true },
    fileKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    originalFileName: { type: String, trim: true },
    fileSize: { type: Number },

    extractedText: { type: String, default: '' },
    extractionStatus: { type: String, enum: EXTRACTION_STATUSES, default: 'pending' },
  },
  { timestamps: true },
);

documentSchema.index({ userId: 1, documentDate: -1 });
documentSchema.index({ userId: 1, docType: 1 });

export default mongoose.model('Document', documentSchema);
