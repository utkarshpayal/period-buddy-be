import express from 'express';
import multer from 'multer';
import * as hr from '../controllers/hrController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission, requireStaff } from '../middleware/rbac.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import { MAX_TEMPLATE_BYTES } from '../constants/hr.js';

// People & letters in the Admin Workspace: team member records, Canva
// templates, generated letters. Super Admin only (hr.manage). Design and
// contract: period-buddy-content docs/hr-documents.md.
const router = express.Router();
router.use(authenticate, requireStaff, requirePermission(P.HR_MANAGE));

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TEMPLATE_BYTES },
  fileFilter: (req, file, cb) =>
    file.mimetype === 'application/pdf'
      ? cb(null, true)
      : cb(new Error('Upload a PDF (in Canva: Share → Download → PDF Standard)')),
});

/**
 * @route   GET /api/admin/hr/meta
 * @desc    Placeholders, template categories, employment types, member statuses and fonts for the HR editors
 * @access  Private (hr.manage)
 */
router.get('/meta', hr.getMeta);

/**
 * @route   GET /api/admin/hr/members
 * @desc    Team members (HR records, not logins), newest first, with their document count. Query: search, status
 * @access  Private (hr.manage)
 */
router.get('/members', hr.listMembers);
/**
 * @route   POST /api/admin/hr/members
 * @desc    Add a team member. Body: { firstName, lastName?, email, phone?, designation?, department?, employmentType, status, startDate?, endDate?, compensation?, location?, managerName?, address?, customFields?: [{ key, value }], notes? }
 * @access  Private (hr.manage)
 */
router.post('/members', hr.createMember);
/**
 * @route   GET /api/admin/hr/members/:id
 * @desc    A team member and every document made for them
 * @access  Private (hr.manage)
 */
router.get('/members/:id', hr.getMember);
/**
 * @route   PUT /api/admin/hr/members/:id
 * @desc    Replace a team member's details (same body as create)
 * @access  Private (hr.manage)
 */
router.put('/members/:id', hr.updateMember);
/**
 * @route   DELETE /api/admin/hr/members/:id
 * @desc    Delete a team member with their documents and files
 * @access  Private (hr.manage)
 */
router.delete('/members/:id', hr.deleteMember);

/**
 * @route   GET /api/admin/hr/templates
 * @desc    Letter and certificate templates (Canva PDFs with fields or a letter body)
 * @access  Private (hr.manage)
 */
router.get('/templates', hr.listTemplates);
/**
 * @route   POST /api/admin/hr/templates
 * @desc    Upload a template: multipart file (PDF from Canva, ≤ 15 MB) + data (JSON: { name, category, kind: fixed|letterhead, fields?, body?, layout?, requiresSignature?, signatureBox?, emailSubject?, emailBody?, active? })
 * @access  Private (hr.manage)
 */
router.post('/templates', pdfUpload.single('file'), hr.createTemplate);
/**
 * @route   GET /api/admin/hr/templates/:id
 * @desc    One template
 * @access  Private (hr.manage)
 */
router.get('/templates/:id', hr.getTemplate);
/**
 * @route   PUT /api/admin/hr/templates/:id
 * @desc    Save a template: optional multipart file (replaces the PDF, keeping fields) + data (JSON, as for create)
 * @access  Private (hr.manage)
 */
router.put('/templates/:id', pdfUpload.single('file'), hr.updateTemplate);
/**
 * @route   DELETE /api/admin/hr/templates/:id
 * @desc    Delete a template (documents already made keep their own PDFs)
 * @access  Private (hr.manage)
 */
router.delete('/templates/:id', hr.deleteTemplate);
/**
 * @route   GET /api/admin/hr/templates/:id/file
 * @desc    The template's PDF, for the field editor
 * @access  Private (hr.manage)
 */
router.get('/templates/:id/file', hr.getTemplateFile);

/**
 * @route   POST /api/admin/hr/documents/preview
 * @desc    The filled PDF for a template and member, nothing saved. Body: { templateId, memberId, values? }. 400 with data.missing when a placeholder has no value
 * @access  Private (hr.manage)
 */
router.post('/documents/preview', hr.previewDocument);
/**
 * @route   POST /api/admin/hr/documents
 * @desc    Generate a document and optionally email it (with a signing link when the template needs a signature). Body: { templateId, memberId, values?, send, message? }
 * @access  Private (hr.manage)
 */
router.post('/documents', hr.createDocument);
/**
 * @route   GET /api/admin/hr/documents
 * @desc    Documents, newest first (max 200). Query: memberId, status
 * @access  Private (hr.manage)
 */
router.get('/documents', hr.listDocuments);
/**
 * @route   GET /api/admin/hr/documents/:id/file
 * @desc    Download a document. Query: version=original|signed (default: signed when there is one)
 * @access  Private (hr.manage)
 */
router.get('/documents/:id/file', hr.getDocumentFile);
/**
 * @route   POST /api/admin/hr/documents/:id/resend
 * @desc    Email a document again (a new signing link if it's still unsigned). Body: { message? }
 * @access  Private (hr.manage)
 */
router.post('/documents/:id/resend', hr.resendDocument);
/**
 * @route   POST /api/admin/hr/documents/:id/revoke
 * @desc    Revoke an unsigned document: its signing link stops working
 * @access  Private (hr.manage)
 */
router.post('/documents/:id/revoke', hr.revokeDocument);

export default router;
