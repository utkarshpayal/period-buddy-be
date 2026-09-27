// Pure helpers for HR documents: validating members and templates, and
// filling {{placeholders}}. No I/O, so they can be unit tested; PDF work is
// in utils/hrPdf.js and requests in controllers/hrController.js.
import {
  EMPLOYMENT_TYPES,
  FONT_FAMILIES,
  MAX_CUSTOM_FIELDS,
  MAX_FIELDS,
  MEMBER_STATUSES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_KINDS,
  companyName,
} from '../constants/hr.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOM_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,30}$/;
const HEX = /^#[0-9a-f]{6}$/i;
// {{ key }} or { key }: the name inside is forgiving (see canonicalKey).
const PLACEHOLDER = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}|\{\s*([A-Za-z][^{}\n]{0,58}?)\s*\}/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const values = (list) => list.map((x) => x.value);
const labelOf = (list, value) => list.find((x) => x.value === value)?.label ?? value;

const text = (v, max, label, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    return required ? { error: `${label} is required` } : { value: null };
  }
  if (typeof v !== 'string') return { error: `${label} must be text` };
  const t = v.trim();
  if (!t && required) return { error: `${label} is required` };
  if (t.length > max) return { error: `${label} must be at most ${max} characters` };
  return { value: t || null };
};

/** "1 October 2026", in India time. */
export const formatDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(d);
};

/* --------------------------------- Members -------------------------------- */

export const parseMember = (raw = {}) => {
  const out = {};
  const fields = [
    ['firstName', 60, 'First name', true],
    ['lastName', 60, 'Last name'],
    ['phone', 30, 'Phone'],
    ['designation', 80, 'Designation'],
    ['department', 60, 'Department'],
    ['compensation', 120, 'Compensation'],
    ['location', 80, 'Location'],
    ['managerName', 80, 'Manager'],
    ['address', 300, 'Address'],
    ['notes', 1000, 'Notes'],
  ];
  for (const [key, max, label, required] of fields) {
    const r = text(raw[key], max, label, { required });
    if (r.error) return { error: r.error };
    out[key] = r.value;
  }
  const email = text(raw.email, 120, 'Email', { required: true });
  if (email.error) return { error: email.error };
  if (!EMAIL.test(email.value)) return { error: 'Enter a valid email' };
  out.email = email.value.toLowerCase();

  out.employmentType = raw.employmentType ?? 'full_time';
  if (!values(EMPLOYMENT_TYPES).includes(out.employmentType)) {
    return { error: 'Invalid employment type' };
  }
  out.status = raw.status ?? 'offered';
  if (!values(MEMBER_STATUSES).includes(out.status)) return { error: 'Invalid status' };

  for (const key of ['startDate', 'endDate']) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') out[key] = null;
    else if (typeof v !== 'string' || !ISO_DATE.test(v.slice(0, 10))) {
      return { error: `${key === 'startDate' ? 'Start' : 'End'} date must look like 2026-10-01` };
    } else out[key] = v.slice(0, 10);
  }
  if (out.startDate && out.endDate && out.endDate < out.startDate) {
    return { error: 'The end date is before the start date' };
  }

  const custom = Array.isArray(raw.customFields) ? raw.customFields : [];
  if (custom.length > MAX_CUSTOM_FIELDS) {
    return { error: `At most ${MAX_CUSTOM_FIELDS} custom fields` };
  }
  const seen = new Set();
  out.customFields = [];
  for (const c of custom) {
    const key = typeof c?.key === 'string' ? c.key.trim() : '';
    if (!key && !c?.value) continue;
    if (!CUSTOM_KEY.test(key)) {
      return { error: `Custom field “${key}”: use letters, numbers and _ (start with a letter)` };
    }
    if (seen.has(key)) return { error: `Custom field “${key}” is listed twice` };
    seen.add(key);
    const value = text(c.value, 500, `Custom field “${key}”`);
    if (value.error) return { error: value.error };
    out.customFields.push({ key, value: value.value ?? '' });
  }
  return { member: out };
};

export const fullName = (m) => [m.firstName, m.lastName].filter(Boolean).join(' ');

/** Every value a template can use for this member ({{custom.x}} included). */
export const memberValues = (member, { documentNumber = '', now = new Date() } = {}) => {
  const v = {
    firstName: member.firstName ?? '',
    lastName: member.lastName ?? '',
    fullName: fullName(member),
    email: member.email ?? '',
    phone: member.phone ?? '',
    designation: member.designation ?? '',
    department: member.department ?? '',
    employmentType: member.employmentType ? labelOf(EMPLOYMENT_TYPES, member.employmentType) : '',
    startDate: formatDate(member.startDate),
    endDate: formatDate(member.endDate),
    compensation: member.compensation ?? '',
    location: member.location ?? '',
    managerName: member.managerName ?? '',
    address: member.address ?? '',
    today: formatDate(now),
    companyName: companyName(),
    documentNumber,
    documentSeq: String(documentNumber).split('/').pop() ?? '',
  };
  for (const c of member.customFields ?? []) {
    // Both {{custom.team}} and plain {{team}} work (a built-in wins a clash).
    const key = camel(c.key);
    v[`custom.${key}`] = c.value ?? '';
    if (!(key in v)) v[key] = c.value ?? '';
  }
  return v;
};

/* ------------------------------ Placeholders ------------------------------ */

// What people actually type in a Canva design or a letter, squashed
// (lower case, letters and digits only) → the built-in key it means.
const ALIASES = {
  firstname: 'firstName',
  first: 'firstName',
  givenname: 'firstName',
  lastname: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  fullname: 'fullName',
  name: 'fullName',
  candidatefullname: 'fullName',
  candidatename: 'fullName',
  internname: 'fullName',
  employeename: 'fullName',
  recipientname: 'fullName',
  membername: 'fullName',
  email: 'email',
  emailaddress: 'email',
  emailid: 'email',
  phone: 'phone',
  mobile: 'phone',
  phonenumber: 'phone',
  mobilenumber: 'phone',
  contact: 'phone',
  designation: 'designation',
  role: 'designation',
  roletitle: 'designation',
  position: 'designation',
  jobtitle: 'designation',
  positionheld: 'designation',
  department: 'department',
  dept: 'department',
  team: 'department',
  departmentteam: 'department',
  employmenttype: 'employmentType',
  type: 'employmentType',
  startdate: 'startDate',
  joiningdate: 'startDate',
  dateofjoining: 'startDate',
  doj: 'startDate',
  fromdate: 'startDate',
  enddate: 'endDate',
  lastdate: 'endDate',
  relievingdate: 'endDate',
  todate: 'endDate',
  lastworkingday: 'endDate',
  compensation: 'compensation',
  stipend: 'compensation',
  salary: 'compensation',
  ctc: 'compensation',
  pay: 'compensation',
  location: 'location',
  mode: 'location',
  workmode: 'location',
  worklocation: 'location',
  manager: 'managerName',
  managername: 'managerName',
  mentor: 'managerName',
  mentorname: 'managerName',
  reportingto: 'managerName',
  reportingmanager: 'managerName',
  supervisor: 'managerName',
  address: 'address',
  addressline1: 'address',
  recipientaddress: 'address',
  today: 'today',
  date: 'today',
  issuedate: 'today',
  issued: 'today',
  dateofissue: 'today',
  currentdate: 'today',
  companyname: 'companyName',
  company: 'companyName',
  organisation: 'companyName',
  organization: 'companyName',
  documentnumber: 'documentNumber',
  ref: 'documentNumber',
  refno: 'documentNumber',
  reference: 'documentNumber',
  referencenumber: 'documentNumber',
  docno: 'documentNumber',
  certificatenumber: 'documentNumber',
  documentseq: 'documentSeq',
  seq: 'documentSeq',
  serial: 'documentSeq',
  serialno: 'documentSeq',
};
const squash = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const camel = (s) =>
  String(s)
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w, i) =>
      i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join('');

/**
 * The key a typed field name means: "First Name", "first_name", "FIRSTNAME"
 * and "firstName" are all `firstName`; "Candidate Full Name" is `fullName`;
 * "custom.Team" is `custom.team`. Anything unknown becomes camelCase
 * ("Reporting time" → `reportingTime`) and is asked for when sending.
 */
export const canonicalKey = (raw) => {
  const s = String(raw ?? '').trim();
  const m = /^custom\.(.+)$/i.exec(s);
  if (m) return `custom.${camel(m[1])}`;
  const alias = ALIASES[squash(s)];
  if (alias) return alias;
  const c = camel(s);
  return /^[A-Za-z][A-Za-z0-9]*$/.test(c) ? c : '';
};

export const extractPlaceholders = (...strings) => {
  const keys = new Set();
  for (const s of strings) {
    if (typeof s !== 'string') continue;
    for (const m of s.matchAll(PLACEHOLDER)) {
      const key = canonicalKey(m[1] ?? m[2]);
      if (key) keys.add(key);
    }
  }
  return [...keys];
};

/** Keys a template needs: its fields, body and email text. */
export const templatePlaceholders = (t) => [
  ...new Set([
    ...(t.kind === 'fixed'
      ? (t.fields ?? []).flatMap((f) => (f.text ? extractPlaceholders(f.text) : [f.key]))
      : []),
    ...extractPlaceholders(t.kind === 'letterhead' ? t.body : '', t.emailSubject, t.emailBody),
  ]),
];

export const fillText = (s, v) =>
  typeof s === 'string'
    ? s.replace(PLACEHOLDER, (whole, a, b) => {
        const key = canonicalKey(a ?? b);
        return key ? (v[key] ?? '') : whole;
      })
    : '';

/**
 * Member values overlaid with the ones typed in the send dialog, and the
 * keys the template needs that are still empty (documentNumber is only
 * known at generation, so it never counts as missing).
 */
export const resolveValues = (template, base, overrides = {}) => {
  const merged = { ...base };
  for (const [k, val] of Object.entries(overrides ?? {})) {
    const key = canonicalKey(k);
    if (key && typeof val === 'string' && val.trim()) merged[key] = val.trim().slice(0, 2000);
  }
  const missing = templatePlaceholders(template).filter(
    (k) => k !== 'documentNumber' && k !== 'documentSeq' && !String(merged[k] ?? '').trim(),
  );
  return { values: merged, missing };
};

/* -------------------------------- Templates ------------------------------- */

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

const parseCover = (raw, page) => {
  if (!raw || typeof raw !== 'object' || !page) return null;
  const x = num(raw.x, 0, page.width);
  const y = num(raw.y, 0, page.height);
  const width = num(raw.width, 1, page.width);
  const height = num(raw.height, 1, page.height);
  if ([x, y, width, height].includes(null)) return null;
  return { x, y, width, height, color: HEX.test(raw.color ?? '') ? raw.color : '#FFFFFF' };
};

const parseBox = (raw, pages) => {
  if (!raw || typeof raw !== 'object') return null;
  const page =
    Number.isInteger(raw.page) && raw.page >= 0 && raw.page < pages.length ? raw.page : null;
  if (page === null) return null;
  const { width: pw, height: ph } = pages[page];
  const x = num(raw.x, 0, pw);
  const y = num(raw.y, 0, ph);
  const width = num(raw.width, 10, pw);
  const height = num(raw.height, 10, ph);
  if ([x, y, width, height].includes(null)) return null;
  return { page, x, y, width: Math.min(width, pw - x), height: Math.min(height, ph - y) };
};

/**
 * Validate template settings from the CMS against the uploaded PDF's pages
 * ([{ width, height }] in points). Positions outside the page are clamped.
 */
export const parseTemplate = (raw = {}, pages = []) => {
  const name = text(raw.name, 80, 'Name', { required: true });
  if (name.error) return { error: name.error };
  const category = raw.category ?? 'other';
  if (!values(TEMPLATE_CATEGORIES).includes(category)) return { error: 'Invalid category' };
  const kind = raw.kind ?? 'fixed';
  if (!TEMPLATE_KINDS.includes(kind)) return { error: 'Pick fixed design or letterhead' };
  if (!pages.length) return { error: 'Upload the template PDF' };

  const fields = [];
  if (kind === 'fixed') {
    const list = Array.isArray(raw.fields) ? raw.fields : [];
    if (list.length > MAX_FIELDS) return { error: `At most ${MAX_FIELDS} fields` };
    for (const f of list) {
      // A field is one {{key}}, or a line of `text` with {{keys}} in it
      // ("Ref: NC/CERT/{{documentNumber}}"), so a sentence stays one run.
      const fieldText = typeof f?.text === 'string' ? f.text.trim().slice(0, 300) : '';
      const fieldKey = canonicalKey(f?.key);
      if (!fieldText && !fieldKey) {
        return { error: `Field “${f?.key ?? ''}” isn’t a valid key` };
      }
      const box = parseBox({ ...f, height: 10 }, pages);
      if (!box) return { error: `Field ${fieldText || `{{${f.key}}}`} is off the page` };
      fields.push({
        id: String(f.id ?? `${f.key}-${fields.length}`).slice(0, 40),
        key: fieldKey || 'text',
        ...(fieldText ? { text: fieldText } : {}),
        // Paint over what's printed there first: the {{placeholder}} or
        // [ sample ] text a Canva design came with (auto-detected in the editor).
        ...(parseCover(f.cover, pages[box.page])
          ? { cover: parseCover(f.cover, pages[box.page]) }
          : {}),
        page: box.page,
        x: box.x,
        y: box.y,
        width: box.width,
        fontSize: num(f.fontSize, 6, 72) ?? 14,
        font: FONT_FAMILIES.includes(f.font) ? f.font : 'sans',
        bold: f.bold === true,
        color: HEX.test(f.color ?? '') ? f.color : '#1E1823',
        align: ['left', 'center', 'right'].includes(f.align) ? f.align : 'left',
      });
    }
  }

  const body = text(raw.body, 20000, 'Letter body');
  if (body.error) return { error: body.error };
  if (kind === 'letterhead' && !body.value) return { error: 'Write the letter body' };
  const l = raw.layout ?? {};
  const layout = {
    marginTop: num(l.marginTop, 0, 400) ?? 150,
    marginBottom: num(l.marginBottom, 0, 400) ?? 100,
    marginLeft: num(l.marginLeft, 0, 300) ?? 60,
    marginRight: num(l.marginRight, 0, 300) ?? 60,
    fontSize: num(l.fontSize, 7, 24) ?? 11,
    lineHeight: num(l.lineHeight, 1, 2.5) ?? 1.45,
    font: FONT_FAMILIES.includes(l.font) ? l.font : 'sans',
  };

  const requiresSignature = raw.requiresSignature === true;
  let signatureBox = null;
  if (requiresSignature && kind === 'fixed') {
    signatureBox = parseBox(raw.signatureBox, pages);
    if (!signatureBox) return { error: 'Draw where the signature goes' };
  }

  const emailSubject = text(raw.emailSubject, 150, 'Email subject');
  const emailBody = text(raw.emailBody, 5000, 'Email message');
  for (const r of [emailSubject, emailBody]) if (r.error) return { error: r.error };

  return {
    template: {
      name: name.value,
      category,
      kind,
      fields,
      body: body.value ?? '',
      layout,
      requiresSignature,
      signatureBox,
      emailSubject:
        emailSubject.value ||
        `{{companyName}}: your ${labelOf(TEMPLATE_CATEGORIES, category).toLowerCase()}`,
      emailBody:
        emailBody.value ||
        'Hi {{firstName}},\n\nPlease find your document from {{companyName}} attached.\n\nWarm regards,\n{{companyName}}',
      active: raw.active !== false,
    },
  };
};

export const escapeHtml = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
