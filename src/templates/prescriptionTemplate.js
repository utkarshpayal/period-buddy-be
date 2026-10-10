/**
 * The printable prescription for a teleconsultation: one A4 HTML page that
 * the patient app turns into a PDF (expo-print) and the doctor portal prints.
 * Pure: everything it shows comes in as arguments, nothing is looked up.
 *
 * Laid out like a clinic prescription pad: the doctor's letterhead
 * (qualifications, registration), the patient line, complaints and
 * diagnosis, ℞ with a medicine table, investigations, advice and follow-up,
 * then a signature with a digital seal and the notes a pharmacist expects
 * on an online prescription (Telemedicine Practice Guidelines, India, 2020).
 * A prescription without the structured `rx` (older ones) prints its text.
 */

import { parseDoseSchedule } from '../utils/prescriptionRx.js';

const BRAND = '#C2416F';
const DEFAULT_ZONE = 'Asia/Kolkata';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDate = (date, zone, options) => {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: zone || DEFAULT_ZONE, ...options }).format(
      new Date(date),
    );
  } catch {
    return new Intl.DateTimeFormat('en-IN', { timeZone: DEFAULT_ZONE, ...options }).format(
      new Date(date),
    );
  }
};

/** Whole years between a date of birth and `on`, or null. */
export const ageOn = (dateOfBirth, on = new Date()) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const at = new Date(on);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(at.getTime()) || dob > at) return null;
  let years = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 && years < 130 ? years : null;
};

/** "NURA-RX-1A2B3C4D": short, stable reference a pharmacy can quote back. */
export const prescriptionNumber = (consultationId) =>
  `NURA-RX-${String(consultationId ?? '')
    .slice(-8)
    .toUpperCase()}`;

/** "prescription-2026-10-08-dr-asha-rao.pdf" */
export const prescriptionFileName = ({ issuedAt, doctorName }) => {
  const day = formatDate(issuedAt || new Date(), DEFAULT_ZONE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .split('/')
    .reverse()
    .join('-');
  const who = String(doctorName || 'doctor')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `prescription-${day}-${who || 'doctor'}.pdf`;
};

const GENDER_LABELS = { female: 'Female', male: 'Male', other: 'Other' };

/** Free text as paragraphs: blank lines kept as spacing, nothing dropped. */
const textHtml = (text) =>
  String(text || '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p class="gap"></p>'))
    .join('');

/** "1-0-1" as three counts under Morning / Noon / Night, else the text. */
const frequencyHtml = (frequency) => {
  const counts = parseDoseSchedule(frequency);
  if (!counts) return escapeHtml(frequency || '—');
  return `<span class="dose">${counts.map((c) => `<b>${escapeHtml(c)}</b>`).join('<i>–</i>')}</span>`;
};

const medicinesHtml = (medicines) => `
  <table class="meds">
    <thead>
      <tr><th class="n">#</th><th>Medicine</th><th class="c-dose">Dose</th><th class="c-freq">Frequency<small>Morning · Noon · Night</small></th><th class="c-when">When</th><th class="c-dur">Duration</th></tr>
    </thead>
    <tbody>
      ${medicines
        .map(
          (m, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td class="name"><b>${escapeHtml(m.name.toUpperCase())}</b>${m.notes ? `<small>${escapeHtml(m.notes)}</small>` : ''}</td>
        <td>${escapeHtml(m.dose || '—')}</td>
        <td>${frequencyHtml(m.frequency)}</td>
        <td>${escapeHtml(m.timing || '—')}</td>
        <td>${escapeHtml(m.duration || '—')}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>`;

const sectionHtml = (label, text) =>
  text
    ? `<div class="block"><h3>${escapeHtml(label)}</h3><div class="text">${textHtml(text)}</div></div>`
    : '';

/** A round "digitally signed" seal, drawn in SVG so it prints crisply. */
const sealSvg = (dateText) => `
  <svg class="seal" viewBox="0 0 120 120" aria-hidden="true">
    <defs><path id="sealPath" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" /></defs>
    <circle cx="60" cy="60" r="56" fill="none" stroke="${BRAND}" stroke-width="2" />
    <circle cx="60" cy="60" r="34" fill="none" stroke="${BRAND}" stroke-width="1" />
    <text fill="${BRAND}" font-size="9" font-weight="700">
      <textPath href="#sealPath" textLength="268" lengthAdjust="spacing">THE NURA CARE · DIGITALLY SIGNED ·</textPath>
    </text>
    <text x="60" y="58" fill="${BRAND}" font-size="20" font-weight="700" text-anchor="middle" font-family="Georgia, serif">&#8478;</text>
    <text x="60" y="74" fill="${BRAND}" font-size="7.5" font-weight="700" text-anchor="middle">${escapeHtml(dateText)}</text>
  </svg>`;

/**
 * @param {object} input
 * @param {object} input.consultation  _id, prescription, rx, scheduledFor, slotTimezone
 * @param {object} input.doctor        name, specialty, education[], licenses[], hospital
 * @param {object} input.patient       _id, firstName, lastName, dateOfBirth, gender
 * @param {Date}   [input.issuedAt]    when the prescription was written
 * @returns {string} a complete HTML document
 */
export const renderPrescriptionHtml = ({ consultation, doctor, patient, issuedAt }) => {
  const zone = consultation?.slotTimezone || DEFAULT_ZONE;
  const issued = issuedAt || consultation?.updatedAt || new Date();
  const patientName =
    [patient?.firstName, patient?.lastName].filter(Boolean).join(' ').trim() || 'Patient';
  const age = ageOn(patient?.dateOfBirth, issued);
  const gender = GENDER_LABELS[String(patient?.gender || '').toLowerCase()] || '';
  const ageSex = [age !== null ? `${age} yrs` : '', gender].filter(Boolean).join(' / ') || '—';
  const patientId = patient?._id ? `NU-${String(patient._id).slice(-6).toUpperCase()}` : '—';
  const doctorName = doctor?.name || 'Doctor';
  const qualifications = (doctor?.education || []).filter(Boolean).join(', ');
  const registration = (doctor?.licenses || []).filter(Boolean).join(', ');
  const rxNumber = prescriptionNumber(consultation?._id);
  const rx = consultation?.rx;
  const structured = Boolean(rx && (rx.medicines?.length || rx.advice || rx.investigations));
  const consultedOn = consultation?.scheduledFor
    ? formatDate(consultation.scheduledFor, zone, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
  const issuedDate = formatDate(issued, zone, { day: '2-digit', month: 'short', year: 'numeric' });
  const issuedStamp = formatDate(issued, zone, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const sealDate = formatDate(issued, zone, { day: '2-digit', month: '2-digit', year: 'numeric' });

  const body = structured
    ? `
      ${rx.complaints || rx.diagnosis ? `<div class="pair">${sectionHtml('Chief complaints', rx.complaints)}${sectionHtml('Diagnosis', rx.diagnosis)}</div>` : ''}
      <div class="rx-head"><span class="rx-symbol">&#8478;</span></div>
      ${rx.medicines?.length ? medicinesHtml(rx.medicines) : ''}
      ${rx.investigations || rx.advice ? `<div class="pair">${sectionHtml('Investigations advised', rx.investigations)}${sectionHtml('Advice', rx.advice)}</div>` : ''}
      ${rx.followUp ? `<div class="follow"><span>Follow-up</span><b>${escapeHtml(rx.followUp)}</b></div>` : ''}`
    : `
      <div class="rx-head"><span class="rx-symbol">&#8478;</span></div>
      <div class="free">${textHtml(consultation?.prescription)}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Prescription ${escapeHtml(rxNumber)} · ${escapeHtml(patientName)}</title>
<style>
  @page { size: A4; margin: 12mm 12mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    color: #1E1823;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { display: flex; flex-direction: column; margin: 0 auto; max-width: 186mm; min-height: 271mm; position: relative; }
  .watermark {
    color: ${BRAND}; font-family: Georgia, serif; font-size: 260pt; font-weight: 700; left: 50%; line-height: 1;
    opacity: 0.035; pointer-events: none; position: absolute; top: 46%; transform: translate(-50%, -50%);
  }
  .band { background: linear-gradient(90deg, ${BRAND}, #9E2F58); border-radius: 3px; height: 6px; margin-bottom: 14px; }

  /* Letterhead */
  .head { display: flex; gap: 20px; justify-content: space-between; }
  .doctor h1 { color: #1E1823; font-family: Georgia, "Times New Roman", serif; font-size: 20pt; font-weight: 700; letter-spacing: 0.005em; margin: 0; }
  .doctor .deg { color: ${BRAND}; font-size: 10pt; font-weight: 700; margin: 2px 0 0; }
  .doctor p { color: #453C4C; font-size: 9pt; margin: 2px 0 0; }
  .doctor .reg { color: #1E1823; font-weight: 700; }
  .clinic { align-items: flex-end; display: flex; flex-direction: column; text-align: right; }
  .logo { align-items: center; display: flex; gap: 8px; }
  .mark { align-items: center; background: ${BRAND}; border-radius: 9px; color: #fff; display: flex; font-family: Georgia, serif; font-size: 16pt; font-weight: 700; height: 34px; justify-content: center; width: 34px; }
  .logo b { display: block; font-size: 12pt; text-align: left; }
  .logo small { color: #736A79; display: block; font-size: 7.5pt; letter-spacing: 0.1em; text-align: left; text-transform: uppercase; }
  .clinic p { color: #5E5566; font-size: 8.5pt; margin: 6px 0 0; }
  .rule { border: 0; border-top: 1.5px solid #1E1823; margin: 12px 0 0; }
  .rule + .rule { border-top-width: 0.5px; margin-top: 2px; }

  /* Patient strip */
  .patient { display: grid; gap: 6px 18px; grid-template-columns: 2.4fr 1fr 1.2fr; margin: 12px 0 14px; }
  .patient div { border-bottom: 1px dotted #A39AA8; display: flex; gap: 6px; padding-bottom: 3px; white-space: nowrap; }
  .patient span { color: #736A79; font-size: 8.5pt; font-weight: 700; }
  .patient b { font-size: 10pt; overflow: hidden; text-overflow: ellipsis; }

  /* Body */
  .main { flex: 1 1 auto; position: relative; }
  .pair { display: grid; gap: 18px; grid-template-columns: 1fr 1fr; margin-bottom: 12px; }
  .pair .block:only-child { grid-column: 1 / -1; }
  .block h3 { color: ${BRAND}; font-size: 8pt; font-weight: 800; letter-spacing: 0.1em; margin: 0 0 3px; text-transform: uppercase; }
  .block .text p, .free p { margin: 0; white-space: pre-wrap; word-break: break-word; }
  .block .text p.gap, .free p.gap { height: 0.6em; }
  .rx-head { margin: 4px 0 6px; }
  .rx-symbol { color: ${BRAND}; font-family: Georgia, "Times New Roman", serif; font-size: 28pt; font-weight: 700; line-height: 1; }
  .free { font-size: 11pt; line-height: 1.7; padding-left: 4px; }

  .meds { border-collapse: collapse; font-size: 9.8pt; margin-bottom: 14px; width: 100%; }
  .meds th {
    background: #FBF8FA; border-bottom: 1.5px solid #1E1823; border-top: 1.5px solid #1E1823; color: #453C4C;
    font-size: 7.8pt; font-weight: 800; letter-spacing: 0.06em; padding: 6px 8px; text-align: left; text-transform: uppercase; vertical-align: bottom;
  }
  .meds th small { color: #736A79; display: block; font-size: 6.5pt; font-weight: 600; letter-spacing: 0.02em; text-transform: none; }
  .meds td { border-bottom: 1px solid #ECE5EA; padding: 8px; vertical-align: top; }
  .meds tr { page-break-inside: avoid; }
  .meds .n { color: #736A79; text-align: center; width: 22px; }
  .meds .c-dose { width: 82px; }
  .meds .c-freq { width: 118px; }
  .meds .c-when { width: 92px; }
  .meds .c-dur { width: 76px; }
  .meds .name b { display: block; font-size: 10pt; letter-spacing: 0.01em; }
  .meds .name small { color: #5E5566; display: block; font-size: 8.5pt; margin-top: 2px; }
  .dose { align-items: center; display: inline-flex; gap: 3px; white-space: nowrap; }
  .dose b { border: 1px solid #DDD3DA; border-radius: 4px; display: inline-block; font-size: 9.5pt; min-width: 20px; padding: 0 4px; text-align: center; }
  .dose i { color: #A39AA8; font-style: normal; }

  .follow { align-items: center; border: 1.5px dashed ${BRAND}; border-radius: 8px; display: inline-flex; gap: 10px; margin-top: 2px; padding: 6px 12px; }
  .follow span { color: ${BRAND}; font-size: 8pt; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
  .follow b { font-size: 10.5pt; }

  /* Signature */
  .sign { align-items: flex-end; display: flex; gap: 20px; justify-content: space-between; margin-top: 24px; page-break-inside: avoid; }
  .verify { border-left: 3px solid #F7DCE6; color: #5E5566; font-size: 8.2pt; line-height: 1.55; padding-left: 10px; }
  .verify b { color: #1E1823; display: block; font-size: 9.5pt; letter-spacing: 0.05em; }
  .signature { align-items: flex-end; display: flex; gap: 12px; }
  .seal { height: 92px; opacity: 0.9; transform: rotate(-8deg); width: 92px; }
  .who { min-width: 58mm; text-align: center; }
  .autograph {
    color: #1F2A5C; font-family: "Snell Roundhand", "Segoe Script", "Brush Script MT", "URW Chancery L", cursive;
    font-size: 21pt; line-height: 1.1; margin-bottom: 2px; white-space: nowrap;
  }
  .who .line { border-top: 1px solid #1E1823; padding-top: 4px; }
  .who b { display: block; font-size: 10pt; }
  .who small { color: #5E5566; display: block; font-size: 8pt; }

  .foot { border-top: 1px solid #DDD3DA; color: #736A79; display: flex; font-size: 7.5pt; gap: 16px; justify-content: space-between; line-height: 1.5; margin-top: 14px; padding-top: 8px; page-break-inside: avoid; }
  .foot p { margin: 0; }
  .foot .left { max-width: 70%; }
  .foot .right { text-align: right; white-space: nowrap; }

  @media screen {
    body { background: #ECE6EA; padding: 24px 12px; }
    .sheet { background: #fff; border-radius: 3px; box-shadow: 0 2px 6px rgba(30, 24, 35, 0.06), 0 18px 40px rgba(30, 24, 35, 0.12); max-width: 210mm; min-height: 297mm; padding: 12mm; }
  }
  @media screen and (max-width: 600px) {
    body { padding: 0; }
    .sheet { border-radius: 0; box-shadow: none; min-height: 0; padding: 18px 14px; }
    .head, .sign, .foot { flex-direction: column; }
    .clinic { align-items: flex-start; text-align: left; }
    .patient, .pair { grid-template-columns: 1fr; }
    .meds { font-size: 9pt; }
    .meds th, .meds td { padding: 6px 4px; }
  }
</style>
</head>
<body>
<main class="sheet">
  <div class="watermark" aria-hidden="true">&#8478;</div>
  <div class="band"></div>
  <header class="head">
    <div class="doctor">
      <h1>${escapeHtml(doctorName)}</h1>
      ${qualifications ? `<p class="deg">${escapeHtml(qualifications)}</p>` : ''}
      <p>${escapeHtml(doctor?.specialty || '')}</p>
      ${registration ? `<p class="reg">Reg. No. ${escapeHtml(registration)}</p>` : ''}
    </div>
    <div class="clinic">
      <div class="logo">
        <div class="mark">N</div>
        <div><b>The Nura Care</b><small>Online women's health clinic</small></div>
      </div>
      <p>${doctor?.hospital ? `${escapeHtml(doctor.hospital)}<br />` : ''}thenura.care · hello@thenura.care</p>
    </div>
  </header>
  <hr class="rule" /><hr class="rule" />

  <section class="patient" aria-label="Patient">
    <div><span>Name</span><b>${escapeHtml(patientName)}</b></div>
    <div><span>Age/Sex</span><b>${escapeHtml(ageSex)}</b></div>
    <div><span>Date</span><b>${escapeHtml(issuedDate)}</b></div>
    <div><span>Consultation</span><b>Video · ${escapeHtml(consultedOn)}</b></div>
    <div><span>Patient ID</span><b>${escapeHtml(patientId)}</b></div>
    <div><span>Rx No.</span><b>${escapeHtml(rxNumber)}</b></div>
  </section>

  <section class="main" aria-label="Prescription">${body}</section>

  <section class="sign">
    <div class="verify">
      <b>${escapeHtml(rxNumber)}</b>
      Issued ${escapeHtml(issuedStamp)}<br />
      ${registration ? `Prescriber Reg. No. ${escapeHtml(registration)}<br />` : ''}
      To verify, write to hello@thenura.care with this number.
    </div>
    <div class="signature">
      ${sealSvg(sealDate)}
      <div class="who">
        <div class="autograph">${escapeHtml(doctorName.replace(/^Dr\.?\s+/i, ''))}</div>
        <div class="line">
          <b>${escapeHtml(doctorName)}</b>
          ${qualifications ? `<small>${escapeHtml(qualifications)}</small>` : ''}
          ${registration ? `<small>Reg. No. ${escapeHtml(registration)}</small>` : ''}
        </div>
      </div>
    </div>
  </section>

  <footer class="foot">
    <div class="left">
      <p>Issued after an online video consultation, in line with the Telemedicine Practice Guidelines (India, 2020). Not valid for narcotic or psychotropic medicines.</p>
      <p>Take medicines only as prescribed. In an emergency, go to the nearest hospital.</p>
    </div>
    <div class="right">
      <p>${escapeHtml(rxNumber)}</p>
      <p>thenura.care</p>
    </div>
  </footer>
</main>
</body>
</html>`;
};
