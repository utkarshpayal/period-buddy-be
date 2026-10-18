import mongoose from 'mongoose';
import { invalidateMemoOnWrite } from '../utils/memoCache.js';
import {
  SCHEME_CATEGORIES,
  GOVERNMENT_LEVELS,
  SCHEME_ACTION_TYPES,
  SCHEME_TYPES,
} from '../constants/schemeCategories.js';

/**
 * A single machine-checkable eligibility rule. Rules are advisory — they drive
 * the "You may be eligible" hint, never a guarantee. A benefit with no rules is
 * treated as potentially-eligible for everyone in scope.
 */
const eligibilityRuleSchema = new mongoose.Schema(
  {
    // Human-readable criterion, always shown to the user.
    text: { type: String, required: true, trim: true },
    // Optional machine rule for the eligibility checker.
    field: { type: String, trim: true }, // e.g. 'gender' | 'age' | 'isPregnant' | 'state'
    operator: {
      type: String,
      enum: ['eq', 'neq', 'gte', 'lte', 'in', 'exists'],
    },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const applicationStepSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    detail: { type: String, trim: true },
  },
  { _id: false },
);

const governmentBenefitSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    // Short abbreviation shown as a chip, e.g. "PMMVY".
    shortName: { type: String, trim: true },
    type: { type: String, enum: SCHEME_TYPES, default: 'scheme' },

    // State-independent scoping: 'central' benefits ignore `state`; 'state'
    // benefits set `state` (e.g. 'Rajasthan'). New states need only new docs.
    governmentLevel: { type: String, enum: GOVERNMENT_LEVELS, required: true, index: true },
    state: { type: String, trim: true, default: null, index: true },

    categories: {
      type: [{ type: String, enum: SCHEME_CATEGORIES }],
      default: [],
      index: true,
    },

    description: { type: String, required: true },
    // Bullet list of concrete benefits (cash amount, free service, etc.).
    benefits: [{ type: String }],
    // Bullet list of eligibility criteria + optional machine rules.
    eligibility: [eligibilityRuleSchema],
    // Documents typically required.
    documents: [{ type: String }],

    // How the user actually engages with this benefit.
    actionType: { type: String, enum: SCHEME_ACTION_TYPES, default: 'LEARN_MORE' },
    // Free-text application method summary (e.g. "Apply at Anganwadi centre").
    applicationMethod: { type: String, trim: true },
    applicationSteps: [applicationStepSchema],
    // Where to get it / whom to approach (ASHA, ANM, Anganwadi, PHC/CHC...).
    whereToGet: { type: String, trim: true },

    officialUrl: { type: String, trim: true },
    // Name of the official source used to verify the details.
    source: { type: String, trim: true },
    helpline: { type: String, trim: true },

    // Ordering weight for the listing (lower = earlier).
    order: { type: Number, default: 0 },

    lastVerifiedAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Text search across the fields the search box targets.
governmentBenefitSchema.index({ name: 'text', shortName: 'text', description: 'text' });
governmentBenefitSchema.index({ governmentLevel: 1, state: 1, isActive: 1, order: 1 });

// Any write drops the cached app-facing list (utils/memoCache.js).
governmentBenefitSchema.plugin(invalidateMemoOnWrite, { prefix: 'schemes:' });

export default mongoose.model('GovernmentBenefit', governmentBenefitSchema);
