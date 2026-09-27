import mongoose from 'mongoose';
import { DOCUMENT_STATUSES, TEMPLATE_CATEGORIES } from '../constants/hr.js';

/**
 * HrDocument — one generated letter or certificate for one member. It keeps
 * its own PDF (`file`) and the values used, so editing or deleting the
 * template later never changes what was sent. With `requiresSignature`, the
 * emailed link carries a random token; only its SHA-256 is stored here.
 */
const hrDocumentSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'HrMember', required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'HrTemplate', default: null },
    templateName: { type: String, required: true },
    category: { type: String, enum: TEMPLATE_CATEGORIES.map((c) => c.value), default: 'other' },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Filled from the template when generated, so a resend says the same thing.
    emailSubject: { type: String, default: '' },
    emailBody: { type: String, default: '' },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'HrFile', required: true },
    signedFile: { type: mongoose.Schema.Types.ObjectId, ref: 'HrFile', default: null },
    pages: { type: [{ _id: false, width: Number, height: Number }], default: [] },
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'generated' },
    requiresSignature: { type: Boolean, default: false },
    signatureBox: {
      type: new mongoose.Schema(
        {
          page: Number,
          x: Number,
          y: Number,
          width: Number,
          height: Number,
          // where the signing date and the e-signature note go (fixed designs)
          dateX: Number,
          dateY: Number,
          noteX: Number,
          noteY: Number,
        },
        { _id: false },
      ),
      default: null,
    },
    signTokenHash: { type: String, default: null },
    signTokenExpiresAt: { type: Date, default: null },
    sentTo: { type: String, default: null },
    sentAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    signedAt: { type: Date, default: null },
    signerName: { type: String, default: null },
    signerIp: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);

hrDocumentSchema.index({ member: 1, createdAt: -1 });
hrDocumentSchema.index(
  { signTokenHash: 1 },
  { unique: true, partialFilterExpression: { signTokenHash: { $type: 'string' } } },
);

export default mongoose.model('HrDocument', hrDocumentSchema);
