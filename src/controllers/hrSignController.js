import HrDocument from '../models/HrDocument.js';
import HrMember from '../models/HrMember.js';
import HrFile from '../models/HrFile.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { sendMail } from '../utils/mailer.js';
import { MAX_SIGNATURE_BYTES, companyName } from '../constants/hr.js';
import { escapeHtml, fullName } from '../utils/hrValues.js';
import { stampSignature } from '../utils/hrPdf.js';
import { documentFileName, emailDocument, hashToken, loadFile, sendPdf } from './hrController.js';

// The public side of HR e-signing: the link emailed with a document
// (ADMIN_APP_URL/sign/<token>) opens a page in the Admin Workspace that
// calls these. No login; the token is the only key, and it only ever opens
// that one document. Design: period-buddy-content docs/hr-documents.md.

const TOKEN = /^[A-Za-z0-9_-]{30,60}$/;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * The document behind a signing token, or an error response already sent.
 * A signed document stays viewable through its link (to download the
 * signed copy); a revoked or expired unsigned one doesn't.
 */
const findByToken = async (req, res) => {
  const { token } = req.params;
  const doc = TOKEN.test(token ?? '')
    ? await HrDocument.findOne({ signTokenHash: hashToken(token) }).lean()
    : null;
  if (!doc) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'This link isn’t valid. Ask for a new one.');
    return null;
  }
  const expired = doc.signTokenExpiresAt && doc.signTokenExpiresAt < new Date();
  if (doc.status === 'revoked' || (expired && doc.status !== 'signed')) {
    sendError(res, 410, 'This link has expired. Ask for a new one.');
    return null;
  }
  return doc;
};

/** GET /api/sign/:token — what the signing page shows. The first open marks it viewed. */
export const getSigning = async (req, res, next) => {
  try {
    const doc = await findByToken(req, res);
    if (!doc) return undefined;
    if (doc.status === 'sent' || doc.status === 'generated') {
      await HrDocument.updateOne(
        { _id: doc._id, status: { $in: ['sent', 'generated'] } },
        { $set: { status: 'viewed', viewedAt: new Date() } },
      );
    }
    const member = await HrMember.findById(doc.member).select('firstName lastName').lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Document fetched', {
      document: {
        number: doc.number,
        templateName: doc.templateName,
        category: doc.category,
        status: doc.status === 'signed' ? 'signed' : 'viewed',
        requiresSignature: doc.requiresSignature,
        sentAt: doc.sentAt,
        signedAt: doc.signedAt,
        signerName: doc.signerName,
      },
      recipient: member
        ? { firstName: member.firstName, fullName: fullName(member) }
        : { firstName: '', fullName: '' },
      companyName: companyName(),
      signatureBox: doc.signatureBox,
      pages: doc.pages,
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/sign/:token/file — the PDF (the signed copy once signed), shown inline. */
export const getSigningFile = async (req, res, next) => {
  try {
    const doc = await findByToken(req, res);
    if (!doc) return undefined;
    const bytes = await loadFile(doc.signedFile ?? doc.file);
    if (!bytes) return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    const member = await HrMember.findById(doc.member).select('firstName lastName').lean();
    return sendPdf(res, bytes, documentFileName(doc, member ? fullName(member) : 'document'), {
      inline: true,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sign/:token — body { signature: PNG data URL, name, agree }.
 * Stamps the signature into the document's box, stores the signed copy,
 * and emails it to the signer and to whoever sent it.
 */
export const submitSignature = async (req, res, next) => {
  try {
    const doc = await findByToken(req, res);
    if (!doc) return undefined;
    if (doc.status === 'signed') return sendError(res, HTTP_STATUS.CONFLICT, 'Already signed');
    if (!doc.requiresSignature || !doc.signatureBox) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This document doesn’t need a signature');
    }

    const name =
      typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Type your full name');
    }
    if (req.body?.agree !== true) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Tick the box to agree to sign');
    }
    const match = PNG_DATA_URL.exec(
      typeof req.body?.signature === 'string' ? req.body.signature : '',
    );
    const png = match ? Buffer.from(match[1], 'base64') : null;
    if (!png || !png.subarray(0, 4).equals(PNG_MAGIC)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Draw or upload your signature');
    }
    if (png.length > MAX_SIGNATURE_BYTES) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'That signature image is too large');
    }

    const original = await loadFile(doc.file);
    if (!original) return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    const member = await HrMember.findById(doc.member).lean();
    const memberName = member ? fullName(member) : name;
    const signedAt = new Date();
    let signedBytes;
    try {
      signedBytes = await stampSignature(original, doc.signatureBox, png, {
        signerName: name,
        signedAt,
        title: `${doc.templateName} — ${memberName} (signed)`,
      });
    } catch {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'That signature image couldn’t be read');
    }
    const file = await HrFile.create({
      purpose: 'signed',
      fileName: `${doc.number}-signed.pdf`,
      size: signedBytes.length,
      data: Buffer.from(signedBytes),
    });
    // Claim the signing: a double submit (or two tabs) signs once.
    const claimed = await HrDocument.findOneAndUpdate(
      { _id: doc._id, status: { $ne: 'signed' } },
      {
        $set: {
          status: 'signed',
          signedFile: file._id,
          signedAt,
          signerName: name,
          signerIp: req.ip ?? null,
        },
      },
      { new: true },
    ).lean();
    if (!claimed) {
      await HrFile.deleteOne({ _id: file._id });
      return sendError(res, HTTP_STATUS.CONFLICT, 'Already signed');
    }

    recordAudit({
      req,
      action: AUDIT_ACTIONS.HR_DOCUMENT_SIGNED,
      resourceType: 'hr_document',
      resourceId: doc._id,
      metadata: { number: doc.number, signerName: name },
    });

    // Copies: the signer, and whoever sent it (plus HR_NOTIFY_EMAIL, if set).
    const notify = async () => {
      if (member) {
        await emailDocument({ doc: claimed, member, pdfBytes: signedBytes, signed: true });
      }
      const sender = doc.createdBy
        ? await User.findById(doc.createdBy).select('email').lean()
        : null;
      const to = [...new Set([sender?.email, process.env.HR_NOTIFY_EMAIL].filter(Boolean))];
      if (to.length) {
        await sendMail({
          to,
          subject: `Signed: ${doc.templateName} — ${memberName} (${doc.number})`,
          html: `<p>${escapeHtml(name)} signed <strong>${escapeHtml(doc.templateName)}</strong> (${escapeHtml(doc.number)}). The signed copy is attached and in the Admin Workspace under People &amp; letters.</p>`,
          text: `${name} signed ${doc.templateName} (${doc.number}). The signed copy is attached.`,
          attachments: [
            {
              filename: documentFileName(doc, memberName).replace(/\.pdf$/, ' (signed).pdf'),
              content: Buffer.from(signedBytes),
            },
          ],
        });
      }
    };
    notify().catch(() => undefined);

    return sendResponse(res, HTTP_STATUS.OK, 'Signed', { status: 'signed', signedAt });
  } catch (error) {
    next(error);
  }
};
