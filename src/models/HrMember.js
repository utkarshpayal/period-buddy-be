import mongoose from 'mongoose';
import { EMPLOYMENT_TYPES, MEMBER_STATUSES } from '../constants/hr.js';

/**
 * HrMember — someone the startup hired (employee, intern, contractor): an HR
 * record for generating their letters, not a login. Staff accounts live on
 * User; these people never sign in anywhere. Validated by
 * utils/hrValues.js parseMember().
 */
const hrMemberSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: null },
    designation: { type: String, default: null },
    department: { type: String, default: null },
    employmentType: {
      type: String,
      enum: EMPLOYMENT_TYPES.map((t) => t.value),
      default: 'full_time',
    },
    status: { type: String, enum: MEMBER_STATUSES.map((s) => s.value), default: 'offered' },
    // "YYYY-MM-DD": a calendar date, so no time zone shifts it.
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    compensation: { type: String, default: null },
    location: { type: String, default: null },
    managerName: { type: String, default: null },
    address: { type: String, default: null },
    customFields: {
      type: [{ _id: false, key: String, value: String }],
      default: [],
    },
    notes: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

hrMemberSchema.index({ firstName: 1, lastName: 1 });
hrMemberSchema.index({ email: 1 });

export default mongoose.model('HrMember', hrMemberSchema);
