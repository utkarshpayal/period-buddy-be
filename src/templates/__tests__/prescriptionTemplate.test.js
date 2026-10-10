import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageOn,
  prescriptionFileName,
  prescriptionNumber,
  renderPrescriptionHtml,
} from '../prescriptionTemplate.js';

const consultation = {
  _id: '6ac7c88a46ffaa802958c4ab',
  prescription: 'Tab. Folic acid 5 mg\n1-0-0 x 30 days\n\nReview after 4 weeks',
  scheduledFor: new Date('2026-10-08T17:10:00Z'),
  slotTimezone: 'Asia/Kolkata',
};
const doctor = {
  name: 'Dr. Asha Rao',
  specialty: 'Gynecologist',
  education: ['MBBS', 'MS (OBG)'],
  licenses: ['KMC 123456'],
  hospital: 'Nura Clinic',
};
const patient = {
  firstName: 'Priya',
  lastName: 'Sharma',
  dateOfBirth: new Date('1998-12-20'),
  gender: 'female',
};
const issuedAt = new Date('2026-10-08T17:30:00Z');

test('age counts whole years and waits for the birthday', () => {
  assert.equal(ageOn(new Date('1998-12-20'), new Date('2026-10-08')), 27);
  assert.equal(ageOn(new Date('1998-10-08'), new Date('2026-10-08')), 28);
  assert.equal(ageOn(null), null);
  assert.equal(ageOn(new Date('2030-01-01'), new Date('2026-01-01')), null);
});

test('prescription number is the last 8 characters of the id, uppercased', () => {
  assert.equal(prescriptionNumber('6ac7c88a46ffaa802958c4ab'), 'NURA-RX-2958C4AB');
});

test('file name carries the issue date (IST) and the doctor', () => {
  assert.equal(
    prescriptionFileName({ issuedAt, doctorName: 'Dr. Asha Rao' }),
    'prescription-2026-10-08-dr-asha-rao.pdf',
  );
  assert.equal(
    prescriptionFileName({ issuedAt, doctorName: '' }),
    'prescription-2026-10-08-doctor.pdf',
  );
});

test('renders the doctor, registration, patient and every prescription line', () => {
  const html = renderPrescriptionHtml({ consultation, doctor, patient, issuedAt });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Dr\. Asha Rao/);
  assert.match(html, /MBBS, MS \(OBG\)/);
  assert.match(html, /Reg\. No\. KMC 123456/);
  assert.match(html, /Priya Sharma/);
  assert.match(html, /27 yrs \/ Female/);
  assert.match(html, /08 Oct 2026/);
  assert.match(html, /NURA-RX-2958C4AB/);
  assert.match(
    html,
    /<p>Tab\. Folic acid 5 mg<\/p><p>1-0-0 x 30 days<\/p><p class="gap"><\/p><p>Review after 4 weeks<\/p>/,
  );
});

test('escapes everything that comes from people', () => {
  const html = renderPrescriptionHtml({
    consultation: { ...consultation, prescription: '<script>alert(1)</script>' },
    doctor: { ...doctor, name: 'Dr. <b>X</b>' },
    patient: { firstName: '"Q" & A' },
    issuedAt,
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Dr\. &lt;b&gt;X&lt;\/b&gt;/);
  assert.match(html, /&quot;Q&quot; &amp; A/);
});

test('leaves out what the doctor has not filled in', () => {
  const html = renderPrescriptionHtml({
    consultation,
    doctor: { name: 'Dr. Asha Rao', specialty: 'Gynecologist' },
    patient: {},
    issuedAt,
  });
  assert.doesNotMatch(html, /Reg\. No\./);
  assert.match(html, /<span>Name<\/span><b>Patient<\/b>/);
  assert.match(html, /<span>Age\/Sex<\/span><b>—<\/b>/);
});

const rx = {
  complaints: 'Irregular periods for 3 months',
  diagnosis: 'Iron-deficiency anaemia',
  medicines: [
    {
      name: 'Tab. Folic acid 5 mg',
      dose: '1 tablet',
      frequency: '1-0-0',
      timing: 'After food',
      duration: '30 days',
      notes: '',
    },
    {
      name: 'Cap. Vitamin D3 60000 IU',
      dose: '1 capsule',
      frequency: 'Once a week',
      timing: '',
      duration: '8 weeks',
      notes: 'With milk',
    },
  ],
  investigations: 'CBC, Serum ferritin',
  advice: 'Iron-rich diet',
  followUp: 'After 4 weeks',
};

test('a structured prescription prints a medicine table and every section', () => {
  const html = renderPrescriptionHtml({
    consultation: { ...consultation, rx },
    doctor,
    patient: { ...patient, _id: '6abf722c68621b251194bd5a' },
    issuedAt,
  });
  assert.match(html, /<table class="meds">/);
  assert.match(html, /TAB\. FOLIC ACID 5 MG/);
  assert.match(html, /<span class="dose"><b>1<\/b><i>–<\/i><b>0<\/b><i>–<\/i><b>0<\/b><\/span>/);
  assert.match(html, /Once a week/);
  assert.match(html, /<small>With milk<\/small>/);
  for (const text of [
    'Chief complaints',
    'Irregular periods',
    'Diagnosis',
    'Investigations advised',
    'Serum ferritin',
    'Advice',
    'Follow-up',
    'After 4 weeks',
  ]) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /NU-94BD5A/);
  // The free text isn't printed when the structured form is there.
  assert.doesNotMatch(html, /Tab\. Folic acid 5 mg<\/p>/);
});
