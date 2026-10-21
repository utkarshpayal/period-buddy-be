import fs from 'fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Consultation from '../models/Consultation.js';
import Doctor from '../models/Doctor.js';
import Document from '../models/Document.js';
import User from '../models/User.js';
import {
  NURA_MARK_PATH,
  prescriptionFileName,
  prescriptionNumber,
} from '../templates/prescriptionTemplate.js';
import { renderLetterhead } from './hrPdf.js';
import logger from './logger.js';
import { deleteFromS3, uploadBufferToS3 } from './s3.js';

/**
 * A doctor's prescription saved into the patient's Documents: a real,
 * private PDF `Document` (`source: 'consultation'`, one per consultation), so
 * it lists, previews, shares, and feeds the document summary, document chat
 * and health report like any upload, with the prescription text as its
 * `extractedText`. Written when the doctor saves it (`setPrescription`), and
 * caught up by `syncPrescriptionDocuments` for older ones.
 */

const A4 = [595.28, 841.89];
const ROSE = rgb(0.82, 0.18, 0.4);

/** A plain A4 page with Nura's letterhead (logo, name, rule) and footer, to lay the text on. */
const letterheadTemplate = async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const [width, height] = A4;
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const muted = rgb(0.45, 0.42, 0.48);
  let textX = 50;
  try {
    const mark = await doc.embedPng(fs.readFileSync(NURA_MARK_PATH));
    const h = 40;
    const w = (mark.width / mark.height) * h;
    page.drawImage(mark, { x: 50, y: height - 30 - h, width: w, height: h });
    textX = 50 + w + 10;
  } catch {
    // No logo file: the name alone still reads as the letterhead.
  }
  page.drawText('Nura', { x: textX, y: height - 52, size: 20, font: bold, color: ROSE });
  page.drawText("The Nura Care · Women's health clinic", {
    x: textX,
    y: height - 66,
    size: 8.5,
    font: regular,
    color: muted,
  });
  const label = 'PRESCRIPTION';
  page.drawText(label, {
    x: width - 50 - bold.widthOfTextAtSize(label, 11),
    y: height - 50,
    size: 11,
    font: bold,
    color: ROSE,
  });
  const site = 'thenura.care · hello@thenura.care';
  page.drawText(site, {
    x: width - 50 - regular.widthOfTextAtSize(site, 8.5),
    y: height - 64,
    size: 8.5,
    font: regular,
    color: muted,
  });
  page.drawRectangle({ x: 50, y: height - 82, width: width - 100, height: 2, color: ROSE });
  page.drawLine({
    start: { x: 50, y: 52 },
    end: { x: width - 50, y: 52 },
    thickness: 0.5,
    color: rgb(0.85, 0.82, 0.86),
  });
  page.drawText(
    'Issued after an online consultation on The Nura Care. Take medicines only as prescribed.',
    {
      x: 50,
      y: 36,
      size: 8,
      font: regular,
      color: muted,
    },
  );
  return doc.save();
};

const LAYOUT = {
  font: 'sans',
  fontSize: 11,
  lineHeight: 1.5,
  marginTop: 108,
  marginLeft: 50,
  marginRight: 50,
  marginBottom: 76,
};

const dayLabel = (date) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);

export const doctorLabel = (name) => {
  const trimmed = name?.trim();
  if (!trimmed) return '';
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
};

/** The document's title: "Prescription from Dr. Asha Rao". */
export const prescriptionTitle = (doctorName) => {
  const doctor = doctorLabel(doctorName);
  return doctor ? `Prescription from ${doctor}` : 'Prescription from a Nura consultation';
};

/** The PDF's text: who, whom, when, then the prescription itself. `**x**` is bold. */
export const prescriptionPdfBody = ({
  consultationId,
  prescription,
  doctor,
  patientName,
  issuedAt,
}) => {
  const doctorLine = [doctorLabel(doctor?.name) || 'Nura doctor', doctor?.specialty]
    .filter(Boolean)
    .join(' · ');
  return [
    `**${doctorLine}**${doctor?.hospital ? `\n${doctor.hospital}` : ''}`,
    [
      patientName ? `Patient: **${patientName}**` : null,
      `Date: ${dayLabel(issuedAt)}`,
      `No. ${prescriptionNumber(consultationId)}`,
    ]
      .filter(Boolean)
      .join('   ·   '),
    // Markdown-style asterisks in the doctor's text would read as bold
    // markers; "Label:" at a line start (rxToText's sections) is bolded.
    prescription
      .trim()
      .replace(/\*\*/g, '')
      .replace(/^([A-Z][A-Za-z -]{1,30}):/gm, '**$1:**'),
    `Electronically signed by **${doctorLabel(doctor?.name) || 'your Nura doctor'}** on ${dayLabel(issuedAt)}.`,
  ].join('\n\n');
};

/** The prescription as a branded A4 PDF (a Buffer). */
export const renderPrescriptionPdf = async ({
  consultationId,
  prescription,
  doctor,
  patientName,
  issuedAt,
}) => {
  const { bytes } = await renderLetterhead(
    await letterheadTemplate(),
    prescriptionPdfBody({ consultationId, prescription, doctor, patientName, issuedAt }),
    LAYOUT,
    { title: prescriptionTitle(doctor?.name) },
  );
  return Buffer.from(bytes);
};

/**
 * Create or refresh the patient's Document for one consultation's
 * prescription. Returns the Document, or null when there's nothing
 * prescribed. Throws on S3/PDF errors; callers decide how loud to be.
 */
export const savePrescriptionDocument = async (consultationId) => {
  const consultation = await Consultation.findById(consultationId)
    .select('userId doctorId prescription prescribedAt updatedAt')
    .lean();
  const prescription = consultation?.prescription?.trim();
  if (!prescription) return null;

  const userId = consultation.userId?._id ?? consultation.userId;
  const [doctor, patient] = await Promise.all([
    Doctor.findById(consultation.doctorId).select('name specialty hospital').lean(),
    User.findById(userId).select('firstName lastName').lean(),
  ]);
  const issuedAt = consultation.prescribedAt || consultation.updatedAt || new Date();
  const patientName = [patient?.firstName, patient?.lastName].filter(Boolean).join(' ');
  const title = prescriptionTitle(doctor?.name);

  const buffer = await renderPrescriptionPdf({
    consultationId: consultation._id,
    prescription,
    doctor,
    patientName,
    issuedAt,
  });
  const originalFileName = prescriptionFileName({ issuedAt, doctorName: doctor?.name });
  const { key } = await uploadBufferToS3({
    buffer,
    mimeType: 'application/pdf',
    originalName: originalFileName,
    folder: `medical-documents/${userId}`,
  });

  // Saved through the document (not an update query) so the text is encrypted.
  const existing = await Document.findOne({ consultationId: consultation._id });
  const oldKey = existing?.fileKey;
  const document =
    existing ?? new Document({ consultationId: consultation._id, source: 'consultation' });
  Object.assign(document, {
    userId,
    title,
    docType: 'prescription',
    documentDate: issuedAt,
    fileKey: key,
    mimeType: 'application/pdf',
    originalFileName,
    fileSize: buffer.length,
    extractedText: prescription,
    extractionStatus: 'done',
    source: 'consultation',
  });
  await document.save();
  if (oldKey && oldKey !== key) {
    deleteFromS3(oldKey).catch((error) =>
      logger.warn('prescription_document_old_file_delete_failed', {
        action: 'prescription_document_old_file_delete_failed',
        error: error.message,
      }),
    );
  }
  logger.info('prescription_document_saved', {
    action: 'prescription_document_saved',
    consultationId: String(consultation._id),
    created: !existing,
  });
  return document;
};

/** Which consultations need their Document written or rewritten. */
export const staleConsultationIds = (consultations, documents) => {
  const savedAt = new Map(
    documents.map((d) => [String(d.consultationId), new Date(d.updatedAt).getTime()]),
  );
  return consultations
    .filter((c) => {
      const saved = savedAt.get(String(c._id));
      const written = new Date(c.prescribedAt || c.updatedAt || 0).getTime();
      return saved === undefined || saved < written;
    })
    .map((c) => c._id);
};

/**
 * Make sure every prescription this user has is saved in their Documents
 * (prescriptions written before this existed, or a save that failed). Cheap
 * when nothing's missing: two small queries. Never throws.
 */
export const syncPrescriptionDocuments = async (userId) => {
  try {
    const consultations = await Consultation.find({
      userId,
      prescription: { $exists: true, $nin: [null, ''] },
    })
      .select('_id prescribedAt updatedAt')
      .lean();
    if (!consultations.length) return;
    const documents = await Document.find({
      userId,
      consultationId: { $in: consultations.map((c) => c._id) },
    })
      .select('consultationId updatedAt')
      .lean();
    for (const id of staleConsultationIds(consultations, documents)) {
      try {
        await savePrescriptionDocument(id);
      } catch (error) {
        logger.error('prescription_document_sync_failed', {
          action: 'prescription_document_sync_failed',
          consultationId: String(id),
          error: error.message,
        });
      }
    }
  } catch (error) {
    logger.error('prescription_document_sync_error', {
      action: 'prescription_document_sync_error',
      error: error.message,
    });
  }
};
