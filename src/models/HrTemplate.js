import mongoose from 'mongoose';
import { TEMPLATE_CATEGORIES, TEMPLATE_KINDS } from '../constants/hr.js';

const boxSchema = new mongoose.Schema(
  { page: Number, x: Number, y: Number, width: Number, height: Number },
  { _id: false },
);

/**
 * HrTemplate — a letter or certificate designed in Canva and uploaded as a
 * PDF (Canva Free has no fill API). `fixed`: the PDF is the whole document
 * and `fields` say where each {{placeholder}} is drawn. `letterhead`: the
 * PDF is the background and `body` is laid out on it. Positions are PDF
 * points from each page's top-left. Validated by utils/hrValues.js.
 */
const hrTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: TEMPLATE_CATEGORIES.map((c) => c.value), default: 'other' },
    kind: { type: String, enum: TEMPLATE_KINDS, required: true },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'HrFile', required: true },
    fileName: { type: String, required: true },
    pages: { type: [{ _id: false, width: Number, height: Number }], default: [] },
    fields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    body: { type: String, default: '' },
    layout: { type: mongoose.Schema.Types.Mixed, default: {} },
    requiresSignature: { type: Boolean, default: false },
    signatureBox: { type: boxSchema, default: null },
    emailSubject: { type: String, default: '' },
    emailBody: { type: String, default: '' },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);

export default mongoose.model('HrTemplate', hrTemplateSchema);
