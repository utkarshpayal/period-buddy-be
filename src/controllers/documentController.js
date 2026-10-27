import Document, { DOCUMENT_TYPES } from '../models/Document.js';
import DocumentChatMessage from '../models/DocumentChatMessage.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { buildPagination, getPagination, isValidObjectId } from '../utils/apiHelpers.js';
import { uploadBufferToS3, deleteFromS3, getSignedViewUrl } from '../utils/s3.js';
import { assertAllowedUpload } from '../utils/fileValidation.js';
import { countPages, withinPageLimit } from '../utils/documentPages.js';
import { getSettings, getUsageTier } from '../utils/subscriptionAccess.js';
import { maxPagesFor } from '../utils/pricing.js';
import {
  createChatCompletion,
  extractDocumentText,
  getLanguageLabel,
} from '../utils/sarvamClient.js';
import { broadcastToRoom } from '../config/websocket.js';
import logger from '../utils/logger.js';
import { aiAllowed } from '../utils/privacy.js';
import { withAiSafety } from '../utils/aiSafety.js';
import { hasUrgentPattern, urgentReplyFor } from '../utils/companionChat.js';
import { syncPrescriptionDocuments } from '../utils/prescriptionDocumentStore.js';

/**
 * A document as clients see it: `fileUrl` is a fresh 10-minute signed link
 * (documents live in a private S3 folder), and the storage key stays on the
 * server.
 */
const presentDocument = async (doc) => {
  const { fileKey, ...rest } = doc.toJSON ? doc.toJSON() : doc;
  return { ...rest, fileUrl: await getSignedViewUrl({ key: fileKey }) };
};

const MAX_CONTEXT_DOCS = 20;
const MAX_TEXT_PER_DOC = 4000;

const DOC_TYPE_LABELS = {
  prescription: 'Prescription',
  lab_report: 'Lab Report',
  bill: 'Medical Bill',
  scan: 'Scan / Imaging',
  other: 'Other',
};

const languageInstruction = (languageCode) =>
  languageCode && languageCode !== 'en-IN'
    ? ` Respond in ${getLanguageLabel(languageCode)}, not English.`
    : '';

const buildDocumentContext = (documents) =>
  documents
    .map((doc) => {
      const dateLabel = doc.documentDate.toISOString().slice(0, 10);
      const label = DOC_TYPE_LABELS[doc.docType] || 'Other';
      const body = doc.extractedText?.trim()
        ? doc.extractedText.slice(0, MAX_TEXT_PER_DOC)
        : '[No readable text could be extracted from this file]';
      return `"${doc.title}" (${label}, dated ${dateLabel}):\n${body}`;
    })
    .join('\n\n---\n\n');

export const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'No file was uploaded');
    }

    const { title, documentDate } = req.body;
    let { docType } = req.body;

    if (!title || !title.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A document title is required');
    }
    const parsedDate = new Date(documentDate);
    if (!documentDate || Number.isNaN(parsedDate.getTime())) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid document date is required');
    }
    if (!DOCUMENT_TYPES.includes(docType)) {
      docType = 'other';
    }

    // Verify real file content matches an allowed type — the client-declared
    // mimetype the multer filter saw is spoofable, and this is medical data.
    try {
      assertAllowedUpload(req.file.buffer, ['image', 'pdf']);
    } catch (validationError) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, validationError.message);
    }

    // Fair use: a document is read page by page by our AI provider, so long
    // ones are refused while the page limit is on (utils/pricing.js).
    const subscriptionSettings = await getSettings();
    const maxPages = maxPagesFor(
      subscriptionSettings.fairUse,
      await getUsageTier(req.userId, subscriptionSettings),
    );
    if (maxPages != null) {
      const pages = await countPages(req.file.buffer, req.file.mimetype);
      if (!withinPageLimit(pages, maxPages)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          statusCode: HTTP_STATUS.BAD_REQUEST,
          code: 'DOCUMENT_TOO_LONG',
          message: `Documents can be up to ${maxPages} pages. This one has ${pages}.`,
          details: { pages, maxPages },
        });
      }
    }

    const { key } = await uploadBufferToS3({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      folder: `medical-documents/${req.userId}`,
    });

    // Created with extractionStatus 'pending' and the response sent
    // immediately — Sarvam's doc-digitization job can legitimately take
    // 45+ seconds (JOB_POLL_TIMEOUT_MS in sarvamClient.js), well past what
    // a mobile client should have to hold a request open for. Extraction
    // itself runs after the response, fire-and-forget, and its result is
    // broadcast over the uploader's `user_<userId>` WebSocket room below.
    const document = await Document.create({
      userId: req.userId,
      title: title.trim(),
      docType,
      documentDate: parsedDate,
      fileKey: key,
      mimeType: req.file.mimetype,
      originalFileName: req.file.originalname,
      fileSize: req.file.size,
      extractedText: '',
      // Reading the file sends it to our AI provider: not without consent.
      extractionStatus: aiAllowed(req.user) ? 'pending' : 'skipped',
    });

    logger.info('document_uploaded', {
      action: 'document_uploaded',
      userId: req.userId,
      documentId: document._id,
      docType,
      extractionStatus: 'pending',
    });

    sendResponse(res, HTTP_STATUS.CREATED, 'Document uploaded', {
      document: await presentDocument(document),
    });

    if (document.extractionStatus === 'pending') {
      runExtraction(document, req.file.buffer, req.file.mimetype);
    }
  } catch (error) {
    logger.error('document_upload_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/**
 * Fire-and-forget: runs OCR/text extraction for a just-uploaded document and
 * persists the result, then broadcasts `document_extraction_update` to the
 * uploader's personal WebSocket room so the app can update without polling.
 * Must never throw into the caller — this runs after the HTTP response has
 * already been sent, so any failure here can only be logged, not surfaced
 * as a request error; a failure still resolves to extractionStatus:'failed'
 * on the document so the UI isn't left showing 'pending' forever.
 */
async function runExtraction(document, buffer, mimeType) {
  let text = '';
  let status = 'failed';
  try {
    ({ text, status } = await extractDocumentText({ buffer, mimeType }));
  } catch (error) {
    logger.error('document_extraction_error', {
      action: 'document_extraction_error',
      documentId: document._id,
      userId: document.userId,
      error: error.message,
    });
  }

  try {
    document.extractedText = text;
    document.extractionStatus = status;
    await document.save();
  } catch (error) {
    logger.error('document_extraction_save_error', {
      action: 'document_extraction_save_error',
      documentId: document._id,
      userId: document.userId,
      error: error.message,
    });
    return;
  }

  broadcastToRoom(`user_${document.userId}`, {
    type: 'document_extraction_update',
    documentId: document._id,
    extractionStatus: status,
  });
}

export const listDocuments = async (req, res, next) => {
  try {
    const { docType, sort } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });

    const filter = { userId: req.userId };
    if (docType && DOCUMENT_TYPES.includes(docType)) {
      filter.docType = docType;
    }

    const sortOrder = sort === 'asc' ? 1 : -1;
    // Doctors' prescriptions are saved in as documents; catch up any missing.
    if (page === 1) await syncPrescriptionDocuments(req.userId);

    const [documents, total] = await Promise.all([
      Document.find(filter)
        .select('-extractedText')
        .sort({ documentDate: sortOrder })
        .skip(skip)
        .limit(limit),
      Document.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Documents fetched', {
      documents: await Promise.all(documents.map(presentDocument)),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    logger.error('document_list_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

export const getDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid document id');
    }

    const document = await Document.findOne({ _id: id, userId: req.userId });
    if (!document) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Document not found');
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Document fetched', {
      document: await presentDocument(document),
    });
  } catch (error) {
    logger.error('document_get_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

export const deleteDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid document id');
    }

    const existing = await Document.findOne({ _id: id, userId: req.userId })
      .select('source')
      .lean();
    if (!existing) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Document not found');
    }
    // A doctor's prescription is part of the consultation record.
    if (existing.source === 'consultation') {
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        "Prescriptions from your Nura doctor can't be deleted",
      );
    }
    const document = await Document.findOneAndDelete({ _id: id, userId: req.userId });
    if (!document) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Document not found');
    }

    await deleteFromS3(document.fileKey);

    logger.info('document_deleted', {
      action: 'document_deleted',
      userId: req.userId,
      documentId: id,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Document deleted', { id });
  } catch (error) {
    logger.error('document_delete_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

export const summarizeDocuments = async (req, res, next) => {
  try {
    const { startDate, endDate, language } = req.body;

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid startDate and endDate are required');
    }
    end.setHours(23, 59, 59, 999);

    // Doctors' prescriptions are documents too: make sure they're saved first.
    await syncPrescriptionDocuments(req.userId);
    const documents = await Document.find({
      userId: req.userId,
      documentDate: { $gte: start, $lte: end },
    })
      .sort({ documentDate: 1 })
      .limit(MAX_CONTEXT_DOCS);

    if (!documents.length) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'No documents found in that date range');
    }

    const summary = await createChatCompletion({
      messages: [
        {
          role: 'system',
          content:
            withAiSafety(
              "You are a careful medical-records assistant summarizing a patient's own reports, prescriptions (uploaded, or written by their Nura doctor), and bills for their personal reference. Summarize clearly in plain language, grouped by date. Call out abnormal lab values, medication changes, and any follow-up actions mentioned. Put any clearly abnormal or critical value first, marked as needing prompt review with a doctor. Never invent facts that are not present in the documents. End with a short note that this is not medical advice.",
            ) + languageInstruction(language),
        },
        {
          role: 'user',
          content: `Summarize the following ${documents.length} medical document(s) dated between ${start
            .toISOString()
            .slice(
              0,
              10,
            )} and ${end.toISOString().slice(0, 10)}:\n\n${buildDocumentContext(documents)}`,
        },
      ],
      maxTokens: 3000,
    });

    logger.info('document_summary_generated', {
      action: 'document_summary_generated',
      userId: req.userId,
      count: documents.length,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Summary generated', {
      summary,
      documentCount: documents.length,
      documents: documents.map((d) => ({
        id: d._id,
        title: d.title,
        docType: d.docType,
        documentDate: d.documentDate,
      })),
    });
  } catch (error) {
    logger.error('document_summary_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

export const getChatHistory = async (req, res, next) => {
  try {
    // Newest 200, returned oldest-first for display. (Sorting ascending
    // before the limit used to return the *oldest* 200, so once a user
    // passed 200 messages their new ones never showed up.)
    const newestFirst = await DocumentChatMessage.find({ userId: req.userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200);
    const messages = newestFirst.reverse();
    return sendResponse(res, HTTP_STATUS.OK, 'Chat history fetched', { messages });
  } catch (error) {
    logger.error('document_chat_history_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

export const sendChatMessage = async (req, res, next) => {
  try {
    const { message, language } = req.body;
    if (!message || !message.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A message is required');
    }

    await syncPrescriptionDocuments(req.userId);
    const [documents, recentHistory] = await Promise.all([
      Document.find({ userId: req.userId }).sort({ documentDate: -1 }).limit(MAX_CONTEXT_DOCS),
      DocumentChatMessage.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(20),
    ]);

    const userMessage = await DocumentChatMessage.create({
      userId: req.userId,
      role: 'user',
      text: message.trim(),
    });

    // Deterministic urgent check (same patterns as Nura Companion): the urgent
    // guidance is always put first, whatever the model says.
    const urgentPrefix = hasUrgentPattern(message) ? `${urgentReplyFor(null, message)}\n\n` : '';

    if (!documents.length) {
      const reply = `${urgentPrefix}I don't see any uploaded documents yet. Add a report, prescription, or bill from the Documents screen and I can help you understand it.`;
      const assistantMessage = await DocumentChatMessage.create({
        userId: req.userId,
        role: 'assistant',
        text: reply,
      });
      return sendResponse(res, HTTP_STATUS.OK, 'Reply generated', {
        userMessage,
        assistantMessage,
      });
    }

    const conversation = recentHistory.reverse().map((m) => ({ role: m.role, content: m.text }));

    const aiReply = await createChatCompletion({
      messages: [
        {
          role: 'system',
          content: `${withAiSafety(
            "You are a precise medical-records assistant answering a patient's questions about their own documents below: files they uploaded and prescriptions written by their Nura doctor. Answer exactly what was asked, using only these documents and directly relevant general health knowledge — do not pad the answer with unrelated details, background, or repeated caveats. Be concise and correct. Only mention that you are not a doctor when it is directly relevant to the question (e.g. the user is asking for a diagnosis or treatment decision) — do not add it as a default disclaimer on every reply. If a value in the documents is clearly abnormal or critical, always say so and advise prompt review with a doctor, even if the question was about something else. If the answer isn't in the documents, say so plainly and stop there. You may use markdown (lists, bold) when it makes the answer clearer.",
          )}${languageInstruction(language)}\n\nThe patient's documents:\n\n${buildDocumentContext(documents)}`,
        },
        ...conversation,
        { role: 'user', content: message.trim() },
      ],
      maxTokens: 2000,
    });
    const reply = `${urgentPrefix}${aiReply}`;

    const assistantMessage = await DocumentChatMessage.create({
      userId: req.userId,
      role: 'assistant',
      text: reply,
    });

    logger.info('document_chat_reply', { action: 'document_chat_reply', userId: req.userId });

    return sendResponse(res, HTTP_STATUS.OK, 'Reply generated', { userMessage, assistantMessage });
  } catch (error) {
    logger.error('document_chat_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
