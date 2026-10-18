import mongoose from 'mongoose';
import { PERMISSIONS, hasPermission } from '../config/permissions.js';

/**
 * Medical review of app content (blogs, Q&As, reels, health issues,
 * wellbeing guides). Pure rules here; the endpoints live in
 * controllers/contentController.js.
 *
 * Flow: draft --submit--> in_review --approve--> published (stamped)
 *                                   --mark_reviewed--> draft (stamped)
 *                                   --send_back (note)--> draft
 *
 * The stamp (medicallyReviewed, reviewedBy, reviewedById, reviewedAt,
 * reviewNote) is written by the server only, from the acting admin's User
 * record. Only content.approve holders can produce one.
 */

export const REVIEW_ACTIONS = {
  SUBMIT: 'submit',
  APPROVE: 'approve',
  MARK_REVIEWED: 'mark_reviewed',
  SEND_BACK: 'send_back',
};

export const REVIEW_NOTE_MAX_LENGTH = 500;

/** Content states as the review flow sees them. */
export const CONTENT_STATES = {
  PUBLISHED: 'published',
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  ARCHIVED: 'archived',
};

/** Status strings (query/body) that mean "awaiting medical review". */
export const IN_REVIEW_STATUSES = new Set(['in_review', 'in-review', 'review', 'pending_review']);

const ACTION_ALIASES = {
  submit: REVIEW_ACTIONS.SUBMIT,
  submit_for_review: REVIEW_ACTIONS.SUBMIT,
  approve: REVIEW_ACTIONS.APPROVE,
  approve_and_publish: REVIEW_ACTIONS.APPROVE,
  publish: REVIEW_ACTIONS.APPROVE,
  mark_reviewed: REVIEW_ACTIONS.MARK_REVIEWED,
  reviewed: REVIEW_ACTIONS.MARK_REVIEWED,
  send_back: REVIEW_ACTIONS.SEND_BACK,
  reject: REVIEW_ACTIONS.SEND_BACK,
};

export const normalizeReviewAction = (value) =>
  ACTION_ALIASES[
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  ] || null;

/** Which permission each action needs. */
export const REVIEW_ACTION_PERMISSION = {
  [REVIEW_ACTIONS.SUBMIT]: PERMISSIONS.CONTENT_WRITE,
  [REVIEW_ACTIONS.APPROVE]: PERMISSIONS.CONTENT_APPROVE,
  [REVIEW_ACTIONS.MARK_REVIEWED]: PERMISSIONS.CONTENT_APPROVE,
  [REVIEW_ACTIONS.SEND_BACK]: PERMISSIONS.CONTENT_APPROVE,
};

export const canPerformReviewAction = (role, action) =>
  Boolean(REVIEW_ACTION_PERMISSION[action]) &&
  hasPermission(role, REVIEW_ACTION_PERMISSION[action]);

/** Holders of content.approve are medical reviewers. */
export const isMedicalReviewer = (user) =>
  Boolean(user) && hasPermission(user.role, PERMISSIONS.CONTENT_APPROVE);

/**
 * The reviewer behind a request: the acting user when they hold
 * content.approve, else the approver replaying their ChangeRequest
 * (`req.approvedBy`, set by middleware/approvalGate.js), else null.
 */
export const reviewerForRequest = (req) => {
  if (isMedicalReviewer(req?.user)) return req.user;
  if (isMedicalReviewer(req?.approvedBy)) return req.approvedBy;
  return null;
};

/** "First Last", skipping a blank last name, falling back to the email. */
export const reviewerDisplayName = (user) => {
  const name = [user?.firstName, user?.lastName]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ');
  return name || (user?.email ? String(user.email).trim() : '') || 'Nura team';
};

/** Trimmed note, or { error } when too long / required and missing. */
export const normalizeReviewNote = (value, { required = false } = {}) => {
  const note = value == null ? '' : String(value).trim();
  if (required && !note) return { error: 'A short note is required when sending back' };
  if (note.length > REVIEW_NOTE_MAX_LENGTH) {
    return { error: `note must be at most ${REVIEW_NOTE_MAX_LENGTH} characters` };
  }
  return { note: note || null };
};

export const contentState = ({ live, inReview, archived }) => {
  if (live) return CONTENT_STATES.PUBLISHED;
  if (inReview) return CONTENT_STATES.IN_REVIEW;
  if (archived) return CONTENT_STATES.ARCHIVED;
  return CONTENT_STATES.DRAFT;
};

/** The states each action may start from. */
export const REVIEW_TRANSITIONS = {
  [REVIEW_ACTIONS.SUBMIT]: [CONTENT_STATES.DRAFT],
  [REVIEW_ACTIONS.APPROVE]: [CONTENT_STATES.IN_REVIEW],
  // Also lets a reviewer stamp a draft, or live content published before
  // the review flow existed, without changing its visibility.
  [REVIEW_ACTIONS.MARK_REVIEWED]: [
    CONTENT_STATES.IN_REVIEW,
    CONTENT_STATES.DRAFT,
    CONTENT_STATES.PUBLISHED,
  ],
  [REVIEW_ACTIONS.SEND_BACK]: [CONTENT_STATES.IN_REVIEW],
};

const STATE_LABELS = {
  [CONTENT_STATES.PUBLISHED]: 'live',
  [CONTENT_STATES.DRAFT]: 'a draft',
  [CONTENT_STATES.IN_REVIEW]: 'already in review',
  [CONTENT_STATES.ARCHIVED]: 'archived',
};

/**
 * Can `action` run from `state`? Returns { ok: true, nextState } or
 * { ok: false, error } (a 409 for the caller).
 */
export const planReviewTransition = (action, state) => {
  const allowed = REVIEW_TRANSITIONS[action];
  if (!allowed) return { ok: false, error: 'Unknown review action' };
  if (!allowed.includes(state)) {
    return {
      ok: false,
      error:
        action === REVIEW_ACTIONS.SUBMIT
          ? `Only drafts can be submitted for review; this item is ${STATE_LABELS[state]}`
          : `This item is not awaiting review; it is ${STATE_LABELS[state] || state}`,
    };
  }
  const nextState = {
    [REVIEW_ACTIONS.SUBMIT]: CONTENT_STATES.IN_REVIEW,
    [REVIEW_ACTIONS.APPROVE]: CONTENT_STATES.PUBLISHED,
    [REVIEW_ACTIONS.MARK_REVIEWED]:
      state === CONTENT_STATES.PUBLISHED ? CONTENT_STATES.PUBLISHED : CONTENT_STATES.DRAFT,
    [REVIEW_ACTIONS.SEND_BACK]: CONTENT_STATES.DRAFT,
  }[action];
  return { ok: true, nextState };
};

/** Fields that stamp an item as reviewed by `reviewer`. */
export const reviewStamp = (reviewer, { note = null, now = new Date() } = {}) => ({
  medicallyReviewed: true,
  reviewedBy: reviewerDisplayName(reviewer),
  reviewedById: reviewer?._id ?? null,
  reviewedAt: now,
  reviewNote: note || null,
});

/** Fields that remove a stamp (the item needs re-review). */
export const clearedReviewStamp = () => ({
  medicallyReviewed: false,
  reviewedBy: null,
  reviewedById: null,
  reviewedAt: null,
  reviewNote: null,
});

/** Client-sent fields that only the server may write. */
export const SERVER_ONLY_REVIEW_FIELDS = [
  'medicallyReviewed',
  'reviewedBy',
  'reviewedById',
  'reviewedAt',
  'reviewNote',
  'inReview',
  'reviewWorkflow',
  'review',
];

export const stripReviewFields = (body = {}) => {
  const rest = { ...body };
  for (const field of SERVER_ONLY_REVIEW_FIELDS) delete rest[field];
  return rest;
};

/** The medical substance of each type: changing any of it needs re-review. */
export const REVIEWED_CONTENT_FIELDS = {
  blog: ['title', 'content', 'excerpt'],
  video: ['title', 'directMp4Url', 'pollQuestion'],
  'question-answer': ['question', 'answer', 'shortAnswer'],
  'health-issue': [
    'title',
    'summary',
    'guide',
    'symptoms',
    'causes',
    'treatment',
    'prevention',
    'whenToSeeDoctor',
  ],
  wellbeing: ['title', 'summary', 'extendedGuide', 'videoUrl', 'audioUrl'],
};

const comparable = (value) => {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => String(item ?? '').trim()).filter(Boolean));
  }
  if (value == null) return '';
  return String(value).trim();
};

/** Reviewed fields that `updates` actually changes on `current`. */
export const changedReviewedFields = (type, current = {}, updates = {}) =>
  (REVIEWED_CONTENT_FIELDS[type] || []).filter(
    (field) =>
      Object.hasOwn(updates, field) && comparable(updates[field]) !== comparable(current[field]),
  );

/** An edit by a non-reviewer to the substance of a stamped item clears it. */
export const shouldClearReviewStamp = ({ reviewer, stamped, changedFields }) =>
  !reviewer && Boolean(stamped) && changedFields.length > 0;

/**
 * Admin-facing review summary. `object` is a plain content document.
 */
export const describeReview = (object = {}) => {
  const workflow = object.reviewWorkflow || {};
  return {
    medicallyReviewed: Boolean(object.medicallyReviewed),
    by: object.reviewedBy || null,
    at: object.reviewedAt || null,
    note: object.reviewNote || null,
    submittedAt: workflow.submittedAt || null,
    submittedBy: workflow.submittedBy || null,
    sentBackAt: workflow.sentBackAt || null,
    sentBackBy: workflow.sentBackBy || null,
    sentBackNote: workflow.sentBackNote || null,
  };
};

/* ---------------------------------------------------------------------------
 * Schema fields, spread into each reviewable model.
 *
 * medicallyReviewed / reviewedBy / reviewedAt are public (the app shows a
 * badge on published items). Everything else is `select: false`, so the
 * public read endpoints, which return whole documents, never leak staff ids,
 * internal notes or the in-review queue. The admin content API selects them
 * explicitly with REVIEW_ADMIN_SELECT.
 * ------------------------------------------------------------------------- */

const reviewWorkflowSchema = new mongoose.Schema(
  {
    submittedAt: { type: Date },
    submittedBy: { type: String, trim: true },
    submittedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentBackAt: { type: Date },
    sentBackBy: { type: String, trim: true },
    sentBackById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentBackNote: { type: String, trim: true, maxlength: REVIEW_NOTE_MAX_LENGTH },
  },
  { _id: false },
);

export const medicalReviewFields = () => ({
  medicallyReviewed: { type: Boolean, default: false },
  reviewedBy: { type: String, trim: true },
  reviewedAt: { type: Date },
  reviewedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', select: false },
  reviewNote: { type: String, trim: true, maxlength: REVIEW_NOTE_MAX_LENGTH, select: false },
  // Awaiting medical review. Always hidden from the app (the item's own
  // isPublished/isActive stays false while it is in review).
  inReview: { type: Boolean, default: false, select: false },
  reviewWorkflow: { type: reviewWorkflowSchema, select: false },
});

export const REVIEW_ADMIN_SELECT = '+reviewedById +reviewNote +inReview +reviewWorkflow';
