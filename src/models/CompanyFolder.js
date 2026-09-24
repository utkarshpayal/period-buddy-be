import mongoose from 'mongoose';

// A folder in the Company Files library. `parentId: null` means it lives at
// the root. Folders are just an organizing structure in Mongo — nothing is
// stored in S3 for a folder itself, only the files inside it are.
const companyFolderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CompanyFolder',
      default: null,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Two folders with the same name can't sit side by side in the same parent.
companyFolderSchema.index({ parentId: 1, name: 1 }, { unique: true });

export default mongoose.model('CompanyFolder', companyFolderSchema);
