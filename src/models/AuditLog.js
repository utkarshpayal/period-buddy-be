import mongoose from 'mongoose';

/**
 * Append-only audit trail for privileged / security-sensitive operations
 * (admin actions on doctors, content, schemes; account deletions; etc.).
 *
 * Deliberately stores only *references* and small metadata — never medical
 * report contents or other sensitive health data — so the log itself can't
 * become a data-leak surface.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, index: true },
    actorRole: { type: String },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, index: true },
    resourceId: { type: String },
    // Small, non-sensitive context (e.g. which fields changed, target email).
    metadata: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
