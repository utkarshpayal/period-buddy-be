import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

export const DOCUMENT_TYPES = ['prescription', 'lab_report', 'bill', 'scan', 'other'];
// 'skipped': not read because the owner turned AI features off (utils/privacy.js).
export const EXTRACTION_STATUSES = ['pending', 'done', 'limited', 'failed', 'skipped'];

const documentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    docType: { type: String, enum: DOCUMENT_TYPES, default: 'other', index: true },
    documentDate: { type: Date, required: true, index: true },

    // Legacy: the permanent public URL documents used to get. New uploads
    // are private and have none; clients get a short-lived signed `fileUrl`
    // from the controller instead (see utils/s3.js getSignedViewUrl).
    fileUrl: { type: String },
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

// Free text is encrypted at rest (utils/fieldEncryption.js).
documentSchema.plugin(encryptFields, { fields: ['extractedText'] });

export default mongoose.model('Document', documentSchema);
