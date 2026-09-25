import mongoose from 'mongoose';

/**
 * A privileged action a lower-level admin asked for but may not apply
 * directly (e.g. a Content Admin publishing a blog). The original request —
 * params, query and body — is stored as-is and replayed through the same
 * controller when an approver accepts it (see middleware/approvalGate.js),
 * so approval runs the exact validation and side effects a direct call would.
 */
const changeRequestSchema = new mongoose.Schema(
  {
    // Approval-handler registry key, e.g. 'content.update'.
    key: { type: String, required: true },
    department: { type: String, required: true, index: true },
    action: { type: String, required: true },
    resourceType: { type: String },
    resourceId: { type: String },
    // Human-readable one-liner shown in the approvals inbox.
    summary: { type: String, trim: true, maxlength: 300 },

    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    query: { type: mongoose.Schema.Types.Mixed, default: {} },
    body: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Snapshot of the resource when the request was raised, for a diff view.
    before: { type: mongoose.Schema.Types.Mixed },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requesterRole: { type: String },
    requesterNote: { type: String, trim: true, maxlength: 1000 },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
    reviewedAt: { type: Date },
    // What the replayed controller returned on approval (small, for display).
    result: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

changeRequestSchema.index({ department: 1, status: 1, createdAt: -1 });
changeRequestSchema.index({ requestedBy: 1, createdAt: -1 });
changeRequestSchema.index({ resourceType: 1, resourceId: 1, status: 1 });

export default mongoose.model('ChangeRequest', changeRequestSchema);
