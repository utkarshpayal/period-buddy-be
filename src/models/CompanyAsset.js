import mongoose from 'mongoose';

// Broad buckets for the admin library UI (filter chips, icons) — not tied to
// mimetype, since a "pitch" deck might be a PDF or a PPTX either way.
export const COMPANY_ASSET_CATEGORIES = ['pitch', 'flow', 'brand', 'legal', 'policy', 'other'];

// 'file' — uploaded to our S3 bucket, has fileUrl/fileKey/mimeType.
// 'link' — a pointer to something hosted elsewhere (Google Drive, Figma,
// Notion, a YouTube video, ...), has linkUrl instead. Kept in the same
// collection so the admin library lists and searches both together.
export const COMPANY_ASSET_TYPES = ['file', 'link'];

const companyAssetSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    category: { type: String, enum: COMPANY_ASSET_CATEGORIES, default: 'other', index: true },
    assetType: { type: String, enum: COMPANY_ASSET_TYPES, default: 'file', index: true },

    // 'file' fields
    fileUrl: { type: String },
    fileKey: { type: String },
    mimeType: { type: String },
    originalFileName: { type: String, trim: true },
    fileSize: { type: Number },

    // 'link' field
    linkUrl: { type: String, trim: true },

    // Visible to the public site/app when true; otherwise only the admin
    // portal (and anyone with the direct link) can reach it.
    isPublic: { type: Boolean, default: false, index: true },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

companyAssetSchema.pre('validate', function preValidate(next) {
  if (this.assetType === 'link') {
    if (!this.linkUrl) return next(new Error('linkUrl is required for a link entry'));
  } else if (!this.fileUrl || !this.fileKey || !this.mimeType) {
    return next(new Error('fileUrl, fileKey and mimeType are required for an uploaded file'));
  }
  return next();
});

companyAssetSchema.index({ category: 1, createdAt: -1 });
companyAssetSchema.index({ title: 'text', description: 'text' });

export default mongoose.model('CompanyAsset', companyAssetSchema);
