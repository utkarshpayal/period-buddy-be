import crypto from 'crypto';
import HrMember from '../models/HrMember.js';
import HrTemplate from '../models/HrTemplate.js';
import HrDocument from '../models/HrDocument.js';
import HrFile from '../models/HrFile.js';
import HrCounter from '../models/HrCounter.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { sendMail } from '../utils/mailer.js';
import logger from '../utils/logger.js';
import {
  EMPLOYMENT_TYPES,
  FONT_FAMILIES,
  MEMBER_STATUSES,
  PLACEHOLDERS,
  SIGN_LINK_DAYS,
  TEMPLATE_CATEGORIES,
  companyName,
  documentPrefix,
} from '../constants/hr.js';
import {
  escapeHtml,
  fillText,
  fullName,
  memberValues,
  parseMember,
  parseTemplate,
  resolveValues,
  templatePlaceholders,
} from '../utils/hrValues.js';
import { fillFixed, pdfPages, renderLetterhead } from '../utils/hrPdf.js';

// People & letters (Admin Workspace, `hr.manage`): team member records,
// Canva-exported templates, generated letters and their e-signing. Design:
// period-buddy-content docs/hr-documents.md. The public signing side is in
// controllers/hrSignController.js.

const STAFF_FIELDS = 'firstName lastName email';

/* --------------------------------- Helpers -------------------------------- */

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const signUrl = (token) =>
  `${(process.env.ADMIN_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')}/sign/${token}`;

const safeFileName = (s) =>
  String(s)
    .replace(/[\\/:*?"<>|\r\n]+/g, '-')
    .slice(0, 120);

export const documentFileName = (doc, memberName) =>
  safeFileName(`${doc.number.replace(/\//g, '-')} ${doc.templateName} - ${memberName}.pdf`);

/** Send PDF bytes; `inline` shows it in the browser, else it downloads. */
export const sendPdf = (res, bytes, fileName, { inline = false } = {}) => {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeFileName(fileName)}"`,
    'Cache-Control': 'private, no-store',
  });
  return res.send(Buffer.from(bytes));
};

/** A stored file's bytes as a Buffer (lean() hands back a BSON Binary). */
export const loadFile = async (id) => {
  const data = (await HrFile.findById(id).select('data').lean())?.data;
  if (!data) return null;
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer ?? data);
};

const saveFile = (purpose, fileName, bytes) =>
  HrFile.create({ purpose, fileName, size: bytes.length, data: Buffer.from(bytes) });

// Each kind of letter runs its own series, as on the Canva designs:
// NC/INT/2026/0001 for offers, NC/CERT/2026/0001 for completion letters and
// certificates, NC/EXP/… for experience letters.
const SERIES = {
  offer_letter: 'INT',
  internship_completion: 'CERT',
  certificate: 'CERT',
  experience_letter: 'EXP',
};

/** "NC/INT/2026/0007": a per-series, per-year sequence (India time). */
const nextDocumentNumber = async (category) => {
  const year = new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());
  const series = SERIES[category] ?? 'DOC';
  const { seq } = await HrCounter.findOneAndUpdate(
    { key: `${series}-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `${documentPrefix()}/${series}/${year}/${String(seq).padStart(4, '0')}`;
};

const publicTemplate = (t) => ({
  _id: t._id,
  name: t.name,
  category: t.category,
  kind: t.kind,
  pages: t.pages,
  fileName: t.fileName,
  fields: t.fields ?? [],
  body: t.body ?? '',
  layout: t.layout ?? {},
  requiresSignature: Boolean(t.requiresSignature),
  signatureBox: t.signatureBox ?? null,
  emailSubject: t.emailSubject ?? '',
  emailBody: t.emailBody ?? '',
  active: t.active !== false,
  placeholders: templatePlaceholders(t),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

export const publicDocument = (d) => ({
  _id: d._id,
  number: d.number,
  member:
    d.member && typeof d.member === 'object' && d.member._id
      ? { _id: d.member._id, fullName: fullName(d.member), email: d.member.email }
      : null,
  template:
    d.template && typeof d.template === 'object' && d.template._id
      ? { _id: d.template._id, name: d.template.name }
      : null,
  templateName: d.templateName,
  category: d.category,
  status: d.status,
  requiresSignature: Boolean(d.requiresSignature),
  sentTo: d.sentTo ?? null,
  sentAt: d.sentAt ?? null,
  viewedAt: d.viewedAt ?? null,
  signedAt: d.signedAt ?? null,
  signerName: d.signerName ?? null,
  hasSignedFile: Boolean(d.signedFile),
  createdBy: d.createdBy ?? null,
  createdAt: d.createdAt,
});

const populateDocument = (q) =>
  q
    .populate('member', 'firstName lastName email')
    .populate('template', 'name')
    .populate('createdBy', STAFF_FIELDS);

/**
 * Fill a template for a member. Returns `{ missing }` when a placeholder has
 * no value yet, else the PDF bytes, the values used, and where the
 * signature goes.
 */
const generate = async (template, member, overrides, documentNumber) => {
  const { values, missing } = resolveValues(
    template,
    memberValues(member, { documentNumber }),
    overrides,
  );
  if (missing.length) return { missing };
  const templateBytes = await loadFile(template.file);
  if (!templateBytes) throw new Error('The template PDF is missing');
  const title = `${template.name} — ${fullName(member)}`;
  if (template.kind === 'letterhead') {
    const r = await renderLetterhead(
      templateBytes,
      fillText(template.body, values),
      template.layout,
      {
        requiresSignature: template.requiresSignature,
        title,
      },
    );
    return { bytes: r.bytes, values, signatureBox: r.signatureBox, pages: r.pages };
  }
  const bytes = await fillFixed(templateBytes, template.fields, values, { title });
  return {
    bytes,
    values,
    signatureBox: template.requiresSignature ? template.signatureBox : null,
    pages: template.pages,
  };
};

const paragraphsHtml = (s) =>
  escapeHtml(s)
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

/**
 * Email the document (PDF attached) to the member, with a "Review & sign"
 * button when a signing link is given. Returns whether it was delivered.
 */
export const emailDocument = async ({
  doc,
  member,
  pdfBytes,
  message,
  link,
  replyTo,
  signed = false,
}) => {
  const button = link
    ? `<p style="margin:24px 0"><a href="${link}" style="background:#C2416F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">Review &amp; sign</a></p>
       <p style="margin:0 0 14px;color:#736A79;font-size:13px">The link works for ${SIGN_LINK_DAYS} days. You don’t need an account.</p>`
    : '';
  const note = message
    ? `<div style="margin:0 0 18px;padding:12px 14px;background:#FCEEF3;border-radius:10px">${paragraphsHtml(message)}</div>`
    : '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1E1823;max-width:560px">
    ${note}${paragraphsHtml(doc.emailBody)}${button}
    <p style="margin:24px 0 0;color:#A39AA8;font-size:12px">${escapeHtml(doc.number)} · ${escapeHtml(companyName())}</p>
  </div>`;
  const subject = signed ? `Signed: ${doc.emailSubject}` : doc.emailSubject;
  const result = await sendMail({
    to: member.email,
    subject,
    html,
    text: `${message ? `${message}\n\n` : ''}${doc.emailBody}${link ? `\n\nReview & sign: ${link}` : ''}`,
    replyTo,
    attachments: [
      { filename: documentFileName(doc, fullName(member)), content: Buffer.from(pdfBytes) },
    ],
  });
  // Without email in development, the log is the only way to reach the signing page.
  if (!result.delivered && link && process.env.NODE_ENV !== 'production') {
    logger.info('hr_sign_link_dev', { action: 'hr_sign_link_dev', number: doc.number, link });
  }
  return result.delivered;
};

/** A fresh signing link: the token goes in the email, only its hash is kept. */
const newSignToken = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + SIGN_LINK_DAYS * 24 * 60 * 60 * 1000),
  };
};

const badId = (res) => sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');

/* ---------------------------------- Meta ---------------------------------- */

/** GET /api/admin/hr/meta — the lists the editors need. */
export const getMeta = (req, res) =>
  sendResponse(res, HTTP_STATUS.OK, 'HR meta fetched', {
    placeholders: PLACEHOLDERS,
    categories: TEMPLATE_CATEGORIES,
    employmentTypes: EMPLOYMENT_TYPES,
    memberStatuses: MEMBER_STATUSES,
    fonts: FONT_FAMILIES,
    companyName: companyName(),
  });

/* --------------------------------- Members -------------------------------- */

/** GET /api/admin/hr/members?search=&status= */
export const listMembers = async (req, res, next) => {
  try {
    const filter = {};
    if (MEMBER_STATUSES.some((s) => s.value === req.query.status)) filter.status = req.query.status;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 60) : '';
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ firstName: re }, { lastName: re }, { email: re }, { designation: re }];
    }
    const members = await HrMember.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    const counts = await HrDocument.aggregate([
      { $match: { member: { $in: members.map((m) => m._id) } } },
      { $group: { _id: '$member', n: { $sum: 1 } } },
    ]);
    const byMember = new Map(counts.map((c) => [String(c._id), c.n]));
    return sendResponse(res, HTTP_STATUS.OK, 'Members fetched', {
      members: members.map((m) => ({ ...m, documentCount: byMember.get(String(m._id)) ?? 0 })),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/hr/members */
export const createMember = async (req, res, next) => {
  try {
    const parsed = parseMember(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const member = await HrMember.create({
      ...parsed.member,
      createdBy: req.userId,
      updatedBy: req.userId,
    });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_MEMBER_CREATED,
      resourceType: 'hr_member',
      resourceId: member._id,
      metadata: { name: fullName(member) },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Member added', { member });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/hr/members/:id — the member and their documents. */
export const getMember = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const member = await HrMember.findById(req.params.id).lean();
    if (!member) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Member not found');
    const documents = await populateDocument(
      HrDocument.find({ member: member._id }).sort({ createdAt: -1 }),
    ).lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Member fetched', {
      member,
      documents: documents.map(publicDocument),
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/admin/hr/members/:id */
export const updateMember = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const parsed = parseMember(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const member = await HrMember.findByIdAndUpdate(
      req.params.id,
      { $set: { ...parsed.member, updatedBy: req.userId } },
      { new: true },
    ).lean();
    if (!member) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Member not found');
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_MEMBER_UPDATED,
      resourceType: 'hr_member',
      resourceId: member._id,
      metadata: { name: fullName(member) },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Member saved', { member });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/admin/hr/members/:id — with their documents and files. */
export const deleteMember = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const member = await HrMember.findByIdAndDelete(req.params.id).lean();
    if (!member) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Member not found');
    const docs = await HrDocument.find({ member: member._id }).select('file signedFile').lean();
    const files = docs.flatMap((d) => [d.file, d.signedFile]).filter(Boolean);
    await Promise.all([
      HrDocument.deleteMany({ member: member._id }),
      HrFile.deleteMany({ _id: { $in: files } }),
    ]);
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_MEMBER_DELETED,
      resourceType: 'hr_member',
      resourceId: member._id,
      metadata: { name: fullName(member), documents: docs.length },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Member deleted', { id: String(member._id) });
  } catch (error) {
    next(error);
  }
};

/* -------------------------------- Templates ------------------------------- */

const isPdf = (buffer) => buffer?.subarray(0, 5).toString('latin1') === '%PDF-';

const parseData = (req) => {
  if (typeof req.body?.data !== 'string') return req.body ?? {};
  try {
    return JSON.parse(req.body.data);
  } catch {
    return null;
  }
};

/** A newly uploaded PDF: its bytes and page sizes, or `{ error }`. */
const readUpload = async (file) => {
  if (!isPdf(file.buffer))
    return { error: 'Upload a PDF (in Canva: Share → Download → PDF Standard)' };
  try {
    const pages = await pdfPages(file.buffer);
    if (!pages.length) return { error: 'That PDF has no pages' };
    return { pages };
  } catch {
    return { error: 'That PDF can’t be read. Download it from Canva again and retry.' };
  }
};

/** GET /api/admin/hr/templates */
export const listTemplates = async (req, res, next) => {
  try {
    const templates = await HrTemplate.find().sort({ updatedAt: -1 }).lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Templates fetched', {
      templates: templates.map(publicTemplate),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/hr/templates/:id */
export const getTemplate = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const template = await HrTemplate.findById(req.params.id).lean();
    if (!template) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Template not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Template fetched', {
      template: publicTemplate(template),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/hr/templates — multipart `file` (PDF) + `data` (JSON). */
export const createTemplate = async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Upload the template PDF');
    const data = parseData(req);
    if (!data) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid template data');
    const upload = await readUpload(req.file);
    if (upload.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, upload.error);
    const parsed = parseTemplate(data, upload.pages);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const fileName = safeFileName(req.file.originalname || 'template.pdf');
    const file = await saveFile('template', fileName, req.file.buffer);
    const template = await HrTemplate.create({
      ...parsed.template,
      file: file._id,
      fileName,
      pages: upload.pages,
      createdBy: req.userId,
      updatedBy: req.userId,
    });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_TEMPLATE_SAVED,
      resourceType: 'hr_template',
      resourceId: template._id,
      metadata: { name: template.name, kind: template.kind, created: true },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Template saved', {
      template: publicTemplate(template.toObject()),
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/admin/hr/templates/:id — optional new `file`, plus `data`. Fields stay put. */
export const updateTemplate = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const existing = await HrTemplate.findById(req.params.id).lean();
    if (!existing) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Template not found');
    const data = parseData(req);
    if (!data) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid template data');
    let { pages } = existing;
    if (req.file) {
      const upload = await readUpload(req.file);
      if (upload.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, upload.error);
      pages = upload.pages;
    }
    const parsed = parseTemplate(data, pages);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const set = { ...parsed.template, pages, updatedBy: req.userId };
    if (req.file) {
      const fileName = safeFileName(req.file.originalname || 'template.pdf');
      const file = await saveFile('template', fileName, req.file.buffer);
      Object.assign(set, { file: file._id, fileName });
    }
    const template = await HrTemplate.findByIdAndUpdate(
      existing._id,
      { $set: set },
      { new: true },
    ).lean();
    if (req.file) await HrFile.deleteOne({ _id: existing.file });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_TEMPLATE_SAVED,
      resourceType: 'hr_template',
      resourceId: template._id,
      metadata: { name: template.name, kind: template.kind, replacedPdf: Boolean(req.file) },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Template saved', {
      template: publicTemplate(template),
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/admin/hr/templates/:id — documents already made keep their own PDFs. */
export const deleteTemplate = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const template = await HrTemplate.findByIdAndDelete(req.params.id).lean();
    if (!template) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Template not found');
    await HrFile.deleteOne({ _id: template.file });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_TEMPLATE_DELETED,
      resourceType: 'hr_template',
      resourceId: template._id,
      metadata: { name: template.name },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Template deleted', { id: String(template._id) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/hr/templates/:id/file — the uploaded PDF, for the field editor. */
export const getTemplateFile = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const template = await HrTemplate.findById(req.params.id).select('file fileName').lean();
    const bytes = template && (await loadFile(template.file));
    if (!bytes) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Template not found');
    return sendPdf(res, bytes, template.fileName, { inline: true });
  } catch (error) {
    next(error);
  }
};

/* -------------------------------- Documents ------------------------------- */

const loadPair = async (res, { templateId, memberId }) => {
  if (!isValidObjectId(templateId) || !isValidObjectId(memberId)) {
    sendError(res, HTTP_STATUS.BAD_REQUEST, 'Pick a template and a member');
    return null;
  }
  const [template, member] = await Promise.all([
    HrTemplate.findById(templateId).lean(),
    HrMember.findById(memberId).lean(),
  ]);
  if (!template || !member) {
    sendError(res, HTTP_STATUS.NOT_FOUND, template ? 'Member not found' : 'Template not found');
    return null;
  }
  return { template, member };
};

// A 400 that still carries data, so the send dialog can ask for exactly these.
const missingError = (res, missing) =>
  sendResponse(res, HTTP_STATUS.BAD_REQUEST, `Fill in: ${missing.join(', ')}`, { missing });

/** POST /api/admin/hr/documents/preview — the filled PDF, nothing saved. */
export const previewDocument = async (req, res, next) => {
  try {
    const pair = await loadPair(res, req.body ?? {});
    if (!pair) return undefined;
    const r = await generate(pair.template, pair.member, req.body.values, 'PREVIEW');
    if (r.missing) return missingError(res, r.missing);
    return sendPdf(res, r.bytes, `Preview - ${pair.template.name}.pdf`, { inline: true });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/hr/documents — body { templateId, memberId, values?,
 * send, message? }. Generates and stores the PDF; with `send`, emails it
 * (and a signing link when the template needs a signature).
 */
export const createDocument = async (req, res, next) => {
  try {
    const pair = await loadPair(res, req.body ?? {});
    if (!pair) return undefined;
    const { template, member } = pair;
    const probe = resolveValues(template, memberValues(member), req.body.values);
    if (probe.missing.length) return missingError(res, probe.missing);

    const number = await nextDocumentNumber(template.category);
    const r = await generate(template, member, req.body.values, number);
    if (r.missing) return missingError(res, r.missing);
    const file = await saveFile('document', `${number}.pdf`, r.bytes);
    const sign = template.requiresSignature && req.body.send ? newSignToken() : null;
    const doc = await HrDocument.create({
      number,
      member: member._id,
      template: template._id,
      templateName: template.name,
      category: template.category,
      values: r.values,
      emailSubject: fillText(template.emailSubject, r.values),
      emailBody: fillText(template.emailBody, r.values),
      file: file._id,
      pages: r.pages,
      requiresSignature: template.requiresSignature,
      signatureBox: r.signatureBox,
      signTokenHash: sign?.hash ?? null,
      signTokenExpiresAt: sign?.expiresAt ?? null,
      createdBy: req.userId,
    });

    let emailed = false;
    if (req.body.send) {
      const message =
        typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
      emailed = await emailDocument({
        doc,
        member,
        pdfBytes: r.bytes,
        message,
        link: sign ? signUrl(sign.token) : null,
        replyTo: req.user?.email,
      });
      if (emailed) {
        await HrDocument.updateOne(
          { _id: doc._id },
          { $set: { status: 'sent', sentTo: member.email, sentAt: new Date() } },
        );
      }
    }
    recordAudit({
      req,
      action: emailed ? AUDIT_ACTIONS.HR_DOCUMENT_SENT : AUDIT_ACTIONS.HR_DOCUMENT_CREATED,
      resourceType: 'hr_document',
      resourceId: doc._id,
      metadata: { number, template: template.name, member: fullName(member), emailed },
    });
    const saved = await populateDocument(HrDocument.findById(doc._id)).lean();
    return sendResponse(res, HTTP_STATUS.CREATED, emailed ? 'Document sent' : 'Document created', {
      document: publicDocument(saved),
      emailed,
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/hr/documents?memberId=&status= */
export const listDocuments = async (req, res, next) => {
  try {
    const filter = {};
    if (isValidObjectId(req.query.memberId)) filter.member = req.query.memberId;
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    const documents = await populateDocument(
      HrDocument.find(filter).sort({ createdAt: -1 }).limit(200),
    ).lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Documents fetched', {
      documents: documents.map(publicDocument),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/hr/documents/:id/file?version=original|signed */
export const getDocumentFile = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const doc = await HrDocument.findById(req.params.id)
      .populate('member', 'firstName lastName')
      .lean();
    if (!doc) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Document not found');
    const signed = req.query.version !== 'original' && doc.signedFile;
    const bytes = await loadFile(signed ? doc.signedFile : doc.file);
    if (!bytes) return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    const name = documentFileName(doc, doc.member ? fullName(doc.member) : 'member');
    return sendPdf(res, bytes, signed ? name.replace(/\.pdf$/, ' (signed).pdf') : name);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/hr/documents/:id/resend — body { message? }. Emails it
 * again; an unsigned document that needs a signature gets a new link (the
 * old one stops working).
 */
export const resendDocument = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const doc = await HrDocument.findById(req.params.id).lean();
    if (!doc) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Document not found');
    if (doc.status === 'revoked') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This document was revoked');
    }
    const member = await HrMember.findById(doc.member).lean();
    if (!member) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Member not found');

    const signed = Boolean(doc.signedFile);
    const sign = doc.requiresSignature && !signed ? newSignToken() : null;
    const pdfBytes = await loadFile(signed ? doc.signedFile : doc.file);
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
    const emailed = await emailDocument({
      doc,
      member,
      pdfBytes,
      message,
      link: sign ? signUrl(sign.token) : null,
      replyTo: req.user?.email,
      signed,
    });
    const set = {};
    if (emailed) Object.assign(set, { sentTo: member.email, sentAt: new Date() });
    if (emailed && !signed) set.status = doc.status === 'viewed' ? 'viewed' : 'sent';
    if (emailed && sign)
      Object.assign(set, { signTokenHash: sign.hash, signTokenExpiresAt: sign.expiresAt });
    await HrDocument.updateOne({ _id: doc._id }, { $set: set });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_DOCUMENT_SENT,
      resourceType: 'hr_document',
      resourceId: doc._id,
      metadata: { number: doc.number, resend: true, emailed },
    });
    const saved = await populateDocument(HrDocument.findById(doc._id)).lean();
    return sendResponse(res, HTTP_STATUS.OK, emailed ? 'Sent again' : 'Email couldn’t be sent', {
      document: publicDocument(saved),
      emailed,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/hr/documents/:id/revoke — its signing link stops working. */
export const revokeDocument = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res);
    const doc = await HrDocument.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: 'signed' } },
      { $set: { status: 'revoked', signTokenHash: null, signTokenExpiresAt: null } },
      { new: true },
    );
    if (!doc) {
      const exists = await HrDocument.exists({ _id: req.params.id });
      return sendError(
        res,
        exists ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.NOT_FOUND,
        exists ? 'A signed document can’t be revoked' : 'Document not found',
      );
    }
    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_DOCUMENT_REVOKED,
      resourceType: 'hr_document',
      resourceId: doc._id,
      metadata: { number: doc.number },
    });
    const saved = await populateDocument(HrDocument.findById(doc._id)).lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Document revoked', {
      document: publicDocument(saved),
    });
  } catch (error) {
    logger.error('hr_revoke_failed', { action: 'hr_revoke_failed', error: error.message });
    next(error);
  }
};
