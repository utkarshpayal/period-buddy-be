/**
 * Help & support tickets — pure helpers (no DB, unit-tested in
 * __tests__/supportTicket.test.js). The controller is
 * controllers/supportController.js, the model models/SupportTicket.js.
 */

export const SUPPORT_CATEGORIES = [
  { id: 'account', label: 'Account' },
  { id: 'period_tracking', label: 'Period tracking' },
  { id: 'payments', label: 'Payments / Subscription' },
  { id: 'consultation', label: 'Consultation' },
  { id: 'bug', label: 'Bug / App issue' },
  { id: 'other', label: 'Other' },
];
export const SUPPORT_CATEGORY_IDS = SUPPORT_CATEGORIES.map((c) => c.id);

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 140;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
export const REPLY_MAX = 4000;
export const META_FIELD_MAX = 100;
/** Most replies kept on one ticket; past this the person opens a new one. */
export const MAX_REPLIES = 200;

/** NURA-000123: zero-padded to six digits, wider once it outgrows them. */
export const formatTicketNumber = (seq) =>
  `NURA-${String(Math.max(1, Math.floor(seq))).padStart(6, '0')}`;

export const TICKET_NUMBER_REGEX = /^NURA-\d{6,}$/i;

export const categoryLabel = (id) => SUPPORT_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';

/** In-app path a push / inbox row opens (validated by utils/notificationRoute.js). */
export const ticketRoute = (ticketId) => `/support-tickets?id=${ticketId}`;

/** Where new-ticket emails go: SUPPORT_EMAIL, else the contact-form inbox, else the published address. */
export const supportInbox = (env = process.env) =>
  env.SUPPORT_EMAIL || env.CONTACT_RECEIVER_EMAIL || 'hello@thenura.care';

const cleanText = (value) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '');

const cleanLine = (value, max) =>
  typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

/**
 * Device/app info the person chose to attach. Only known keys, short
 * strings; anything else is dropped. Returns null when nothing is left.
 */
export const sanitizeMeta = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of [
    'platform',
    'osVersion',
    'appVersion',
    'deviceModel',
    'buildNumber',
    'locale',
  ]) {
    const v = cleanLine(raw[key] == null ? '' : String(raw[key]), META_FIELD_MAX);
    if (v) out[key] = v;
  }
  if (raw.timezoneOffset != null && Number.isFinite(Number(raw.timezoneOffset))) {
    const tz = Math.round(Number(raw.timezoneOffset));
    if (tz >= -840 && tz <= 840) out.timezoneOffset = tz;
  }
  return Object.keys(out).length ? out : null;
};

/** POST /api/support/tickets body → { value } or { error }. */
export const parseTicketInput = (body = {}) => {
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  if (!SUPPORT_CATEGORY_IDS.includes(category)) {
    return { error: `category must be one of: ${SUPPORT_CATEGORY_IDS.join(', ')}` };
  }
  const subject = cleanLine(body.subject, SUBJECT_MAX + 1);
  if (subject.length < SUBJECT_MIN) return { error: 'Please add a short subject' };
  if (subject.length > SUBJECT_MAX) {
    return { error: `Subject must be at most ${SUBJECT_MAX} characters` };
  }
  const message = cleanText(body.message);
  if (message.length < MESSAGE_MIN) {
    return { error: `Please describe the issue in at least ${MESSAGE_MIN} characters` };
  }
  if (message.length > MESSAGE_MAX) {
    return { error: `Message must be at most ${MESSAGE_MAX} characters` };
  }
  const attach = body.attachAppInfo === true || body.attachAppInfo === 'true';
  return { value: { category, subject, message, meta: attach ? sanitizeMeta(body.meta) : null } };
};

/** Reply body (user or admin) → { value } or { error }. */
export const parseReplyInput = (body = {}) => {
  const message = cleanText(body.message);
  if (!message) return { error: 'Reply cannot be empty' };
  if (message.length > REPLY_MAX) return { error: `Reply must be at most ${REPLY_MAX} characters` };
  return { value: { message } };
};

/**
 * PATCH /api/admin/support/tickets/:id body → { value } (only the fields
 * sent) or { error }. `assignee: null` clears the assignment; the id itself
 * is checked against staff by the controller.
 */
export const parseAdminUpdate = (body = {}) => {
  const value = {};
  if (body.status !== undefined) {
    if (!TICKET_STATUSES.includes(body.status)) {
      return { error: `status must be one of: ${TICKET_STATUSES.join(', ')}` };
    }
    value.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(body.priority)) {
      return { error: `priority must be one of: ${TICKET_PRIORITIES.join(', ')}` };
    }
    value.priority = body.priority;
  }
  if (body.assignee !== undefined) {
    if (body.assignee === null || body.assignee === '') value.assignee = null;
    else if (typeof body.assignee === 'string' && /^[0-9a-f]{24}$/i.test(body.assignee)) {
      value.assignee = body.assignee;
    } else return { error: 'assignee must be a staff user id or null' };
  }
  if (!Object.keys(value).length) return { error: 'Nothing to update' };
  return { value };
};

/**
 * Status after a reply. A user reply re-opens a resolved ticket; an admin
 * reply moves an open one to in progress. A closed ticket takes no user
 * replies (the controller answers 409), but staff can still add a note.
 */
export const statusAfterReply = (status, from) => {
  if (from === 'user') return status === 'resolved' ? 'open' : status;
  return status === 'open' ? 'in_progress' : status;
};

export const userCanReply = (status) => status !== 'closed';

/** Status filter from a query string: a single status, a comma list, or 'active' (open + in progress). */
export const parseStatusFilter = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  if (raw === 'active') return ['open', 'in_progress'];
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => TICKET_STATUSES.includes(s));
  return list.length ? list : null;
};

/** One line for list rows: the first ~140 characters of the message. */
export const previewOf = (text, max = 140) => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
