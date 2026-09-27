import mongoose from 'mongoose';

/**
 * HrFile — the bytes of an HR PDF: a template uploaded from Canva, a
 * generated letter, or its signed copy. Kept in MongoDB rather than S3
 * because the app's bucket is public-read and these hold salaries; they're
 * only served through staff-only or signing-token routes. Separate from the
 * records that point at it, so listing templates or documents never loads
 * the bytes.
 */
const hrFileSchema = new mongoose.Schema(
  {
    purpose: { type: String, enum: ['template', 'document', 'signed'], required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, default: 'application/pdf' },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.model('HrFile', hrFileSchema);
