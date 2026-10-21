import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  prescriptionPdfBody,
  prescriptionTitle,
  renderPrescriptionPdf,
  staleConsultationIds,
} from '../prescriptionDocumentStore.js';

test('titles name the doctor once, or fall back', () => {
  assert.equal(prescriptionTitle('Asha Rao'), 'Prescription from Dr. Asha Rao');
  assert.equal(prescriptionTitle('Dr. Meera'), 'Prescription from Dr. Meera');
  assert.equal(prescriptionTitle(''), 'Prescription from a Nura consultation');
});

test('the PDF body carries doctor, patient, date, number and the text', () => {
  const body = prescriptionPdfBody({
    consultationId: '65f0c0ffee00000000abcdef',
    prescription: 'Medicines:\n1. Tab **X** 1-0-1',
    doctor: { name: 'Asha Rao', specialty: 'Gynaecologist' },
    patientName: 'Priya S',
    issuedAt: new Date('2026-05-02T06:00:00Z'),
  });
  assert.match(body, /\*\*Dr\. Asha Rao · Gynaecologist\*\*/);
  assert.match(body, /Patient: \*\*Priya S\*\*/);
  assert.match(body, /Date: 2 May 2026/);
  assert.match(body, /NURA-RX-00ABCDEF/);
  // The doctor's own asterisks don't turn into bold markers; section labels do.
  assert.match(body, /1\. Tab X 1-0-1/);
  assert.match(body, /\*\*Medicines:\*\*/);
  assert.match(body, /Electronically signed by \*\*Dr\. Asha Rao\*\*/);
});

test('renders a real one-page PDF', async () => {
  const buffer = await renderPrescriptionPdf({
    consultationId: 'c1',
    prescription: 'Advice: rest and fluids.',
    doctor: { name: 'Asha Rao', specialty: 'Gynaecologist' },
    patientName: 'Priya',
    issuedAt: new Date('2026-05-02'),
  });
  const pdf = await PDFDocument.load(buffer);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), 'Prescription from Dr. Asha Rao');
});

test('only missing or out-of-date prescriptions are (re)written', () => {
  const consultations = [
    { _id: 'a', prescribedAt: new Date('2026-05-02') },
    { _id: 'b', prescribedAt: new Date('2026-05-05') },
    { _id: 'c', prescribedAt: new Date('2026-05-01') },
  ];
  const documents = [
    { consultationId: 'a', updatedAt: new Date('2026-05-03') }, // up to date
    { consultationId: 'b', updatedAt: new Date('2026-05-04') }, // doctor edited since
  ];
  assert.deepEqual(staleConsultationIds(consultations, documents), ['b', 'c']);
});
