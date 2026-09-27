import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import { PDFDocument, PDFArray, decodePDFRawStream } from 'pdf-lib';
import {
  extractPlaceholders,
  fillText,
  formatDate,
  memberValues,
  parseMember,
  parseTemplate,
  resolveValues,
  templatePlaceholders,
} from '../hrValues.js';
import { boldRuns, fillFixed, pdfPages, renderLetterhead, stampSignature } from '../hrPdf.js';
import { TEMPLATES } from '../../scripts/seedHrTemplates.js';

const A4 = { width: 595.28, height: 841.89 };

const blankPdf = async (pages = 1, { originY = 0 } = {}) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([A4.width, A4.height]);
    // Canva exports put the visible page at y ≈ 7.8 rather than 0
    if (originY) page.setMediaBox(0, originY, A4.width, A4.height);
  }
  return doc.save();
};

/** The y of every text run drawn on a page (from its content streams' Tm operators). */
const textYs = async (bytes, pageIndex = 0) => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[pageIndex];
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => doc.context.lookup(r))
      : [contents];
  const ops = streams
    .map((st) => Buffer.from(decodePDFRawStream(st).decode()).toString('latin1'))
    .join('\n');
  return [...ops.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
};

// A real PNG (4×2, red), built here so the test needs no fixture file.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const makePng = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0)]);
  for (let x = 0; x < w; x += 1) row[1 + x * 3] = 255;
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
const PNG_BYTES = makePng(4, 2);

const member = {
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya@example.com',
  designation: 'Product Design Intern',
  employmentType: 'intern',
  startDate: '2026-10-01',
  endDate: '2027-03-31',
  compensation: '₹15,000 / month',
  customFields: [{ key: 'team', value: 'Growth' }],
};

test('formatDate writes dates out in words, in India time', () => {
  assert.equal(formatDate('2026-10-01'), '1 October 2026');
  assert.equal(formatDate(null), '');
  assert.equal(formatDate('nope'), '');
});

test('parseMember validates and normalises', () => {
  const ok = parseMember({ ...member, email: 'PRIYA@Example.com ' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.member.email, 'priya@example.com');
  assert.equal(ok.member.status, 'offered');
  for (const bad of [
    { email: 'x@y.co' },
    { firstName: 'A', email: 'nope' },
    { firstName: 'A', email: 'a@b.co', employmentType: 'boss' },
    { firstName: 'A', email: 'a@b.co', startDate: '1/10/2026' },
    { firstName: 'A', email: 'a@b.co', startDate: '2026-10-01', endDate: '2026-09-01' },
    { firstName: 'A', email: 'a@b.co', customFields: [{ key: '1bad', value: 'x' }] },
  ]) {
    assert.ok(parseMember(bad).error, JSON.stringify(bad));
  }
});

test('memberValues and fillText fill built-in and custom placeholders', () => {
  const v = memberValues(member, {
    documentNumber: 'NURA/HR/2026/0001',
    now: new Date('2026-09-27'),
  });
  assert.equal(v.fullName, 'Priya Sharma');
  assert.equal(v.employmentType, 'Intern');
  assert.equal(v['custom.team'], 'Growth');
  assert.equal(
    fillText(
      'Dear {{ firstName }}, you join {{custom.team}} on {{startDate}} ({{documentNumber}}).',
      v,
    ),
    'Dear Priya, you join Growth on 1 October 2026 (NURA/HR/2026/0001).',
  );
  assert.deepEqual(extractPlaceholders('{{a}} {{b.c}} {{a}}', null), ['a', 'bC']);
});

test('resolveValues reports what is still missing, and overrides fill it', () => {
  const template = {
    kind: 'letterhead',
    body: 'Hi {{firstName}}, report at {{reportingTime}} to {{managerName}}.',
    emailSubject: '',
    emailBody: '{{documentNumber}}',
  };
  assert.deepEqual(templatePlaceholders(template).sort(), [
    'documentNumber',
    'firstName',
    'managerName',
    'reportingTime',
  ]);
  const base = memberValues(member);
  assert.deepEqual(resolveValues(template, base).missing.sort(), ['managerName', 'reportingTime']);
  const r = resolveValues(template, base, {
    reportingTime: '10:00 AM',
    managerName: 'Utkarsh',
    'bad key': 'x',
  });
  assert.deepEqual(r.missing, []);
  assert.equal(r.values.reportingTime, '10:00 AM');
});

test('parseTemplate validates fields against the PDF pages', () => {
  const pages = [A4];
  const ok = parseTemplate(
    {
      name: 'Certificate',
      category: 'certificate',
      kind: 'fixed',
      fields: [
        {
          id: 'f1',
          key: 'fullName',
          page: 0,
          x: 100,
          y: 300,
          width: 900,
          fontSize: 28,
          align: 'center',
          color: '#C2416F',
          bold: true,
        },
      ],
      requiresSignature: true,
      signatureBox: { page: 0, x: 60, y: 700, width: 160, height: 60 },
    },
    pages,
  );
  assert.equal(ok.error, undefined);
  assert.equal(ok.template.fields[0].width, A4.width - 100); // clamped to the page
  assert.match(ok.template.emailSubject, /certificate/);
  assert.ok(
    parseTemplate(
      { name: 'x', kind: 'fixed', fields: [{ key: 'fullName', page: 3, x: 0, y: 0, width: 50 }] },
      pages,
    ).error,
  );
  assert.ok(parseTemplate({ name: 'x', kind: 'fixed', requiresSignature: true }, pages).error);
  assert.ok(parseTemplate({ name: 'x', kind: 'letterhead', body: '' }, pages).error);
  assert.ok(parseTemplate({ name: 'x', kind: 'fixed' }, []).error);
});

test('fillFixed draws the values and keeps the pages', async () => {
  const bytes = await fillFixed(
    await blankPdf(),
    [
      {
        key: 'fullName',
        page: 0,
        x: 50,
        y: 100,
        width: 200,
        fontSize: 20,
        font: 'serif',
        bold: true,
        color: '#000000',
        align: 'center',
      },
    ],
    { fullName: 'Priya Sharma — ₹15,000' },
    { title: 'Test' },
  );
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getTitle(), 'Test');
  assert.ok(bytes.length > 2000); // a subset font got embedded
});

test('renderLetterhead flows long text onto more pages and places the signature', async () => {
  const para =
    'This is a long sentence that keeps going so the letter needs several lines. '.repeat(12);
  const body = Array.from({ length: 8 }, () => para).join('\n\n');
  const layout = {
    marginTop: 150,
    marginBottom: 100,
    marginLeft: 60,
    marginRight: 60,
    fontSize: 11,
    lineHeight: 1.45,
    font: 'sans',
  };
  const r = await renderLetterhead(await blankPdf(2), `Dear **Priya**,\n\n${body}`, layout, {
    requiresSignature: true,
  });
  const doc = await PDFDocument.load(r.bytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.equal(r.pages.length, doc.getPageCount());
  assert.equal(r.signatureBox.page, doc.getPageCount() - 1);
  assert.ok(r.signatureBox.y + r.signatureBox.height <= A4.height - layout.marginBottom);
  assert.deepEqual(boldRuns('Hi **there** you'), [
    { text: 'Hi ', bold: false },
    { text: 'there', bold: true },
    { text: ' you', bold: false },
  ]);
});

test('stampSignature embeds the image and pdfPages reads page sizes', async () => {
  const signed = await stampSignature(
    await blankPdf(),
    { page: 0, x: 60, y: 700, width: 160, height: 60 },
    PNG_BYTES,
    { signerName: 'Priya Sharma', signedAt: new Date('2026-10-02T05:30:00Z'), title: 'Signed' },
  );
  const pages = await pdfPages(signed);
  assert.equal(pages.length, 1);
  assert.equal(Math.round(pages[0].width), 595);
  await assert.rejects(() => pdfPages(Buffer.from('not a pdf')));
});

test('a fixed field can be a line of text with placeholders in it', async () => {
  const t = parseTemplate(
    {
      name: 'C',
      kind: 'fixed',
      fields: [
        {
          id: 'r',
          text: 'Ref: NC/CERT/{{documentNumber}} · {{startDate}}',
          page: 0,
          x: 10,
          y: 10,
          width: 200,
        },
      ],
    },
    [A4],
  );
  assert.equal(t.error, undefined);
  assert.equal(t.template.fields[0].text, 'Ref: NC/CERT/{{documentNumber}} · {{startDate}}');
  const keys = templatePlaceholders(t.template);
  assert.ok(
    keys.includes('documentNumber') && keys.includes('startDate') && !keys.includes('text'),
  );
  const bytes = await fillFixed(await blankPdf(), t.template.fields, {
    documentNumber: '0001',
    startDate: '1 October 2026',
  });
  assert.ok(bytes.length > 1500);
});

test('field names are forgiving: case, spaces, single braces and common aliases', async () => {
  const { canonicalKey } = await import('../hrValues.js');
  const cases = {
    firstName: 'firstName',
    'first name': 'firstName',
    FIRSTNAME: 'firstName',
    first_name: 'firstName',
    'Candidate Full Name': 'fullName',
    'Role Title': 'designation',
    Mentor: 'managerName',
    Stipend: 'compensation',
    'Ref No': 'documentNumber',
    'custom.Team Name': 'custom.teamName',
    'Reporting time': 'reportingTime',
  };
  for (const [raw, key] of Object.entries(cases)) assert.equal(canonicalKey(raw), key, raw);
  const v = memberValues(member, { documentNumber: 'NC/1' });
  assert.equal(
    fillText(
      'Dear {{ First Name }}, as {Role Title} ({{ref no}}) in {{custom.team}} / {{team}}',
      v,
    ),
    'Dear Priya, as Product Design Intern (NC/1) in Growth / ',
  );
  const t = {
    kind: 'letterhead',
    body: 'Hi {{First Name}} at {{Reporting Time}}',
    emailSubject: '',
    emailBody: '',
  };
  assert.deepEqual(resolveValues(t, v).missing, ['reportingTime']);
  assert.deepEqual(resolveValues(t, v, { 'Reporting Time': '10 AM' }).missing, []);
});

test('a detected field covers the printed placeholder before drawing the value', async () => {
  const t = parseTemplate(
    {
      name: 'C',
      kind: 'fixed',
      fields: [
        {
          id: 'n',
          key: 'Candidate Full Name',
          page: 0,
          x: 100,
          y: 200,
          width: 300,
          fontSize: 20,
          cover: { x: 120, y: 198, width: 240, height: 26 },
        },
      ],
    },
    [A4],
  );
  assert.equal(t.template.fields[0].key, 'fullName');
  assert.deepEqual(t.template.fields[0].cover, {
    x: 120,
    y: 198,
    width: 240,
    height: 26,
    color: '#FFFFFF',
  });
  const bytes = await fillFixed(await blankPdf(), t.template.fields, { fullName: 'Priya Sharma' });
  assert.ok(bytes.length > 1500);
});

test('a wrap field lays a paragraph out over several lines, at the right height', async () => {
  const t = parseTemplate(
    {
      name: 'Para',
      kind: 'fixed',
      fields: [
        {
          key: 'text',
          text: 'We are delighted to offer you an internship at **{{companyName}}** as {{designation}}. '.repeat(
            3,
          ),
          wrap: true,
          lineHeight: 1.5,
          boldColor: '#1B2E5A',
          page: 0,
          x: 40,
          y: 100,
          width: 300,
          fontSize: 10,
        },
      ],
    },
    [A4],
  );
  assert.equal(t.error, undefined);
  assert.equal(t.template.fields[0].wrap, true);
  assert.equal(t.template.fields[0].boldColor, '#1B2E5A');
  const values = { companyName: 'The Nura Care', designation: 'AI/ML Intern' };
  // A page whose box starts at y = 7.8 (as Canva exports do) lands text at the
  // same distance from the visible top as a plain page does.
  const plain = await textYs(await fillFixed(await blankPdf(), t.template.fields, values));
  const offset = await textYs(
    await fillFixed(await blankPdf(1, { originY: 7.8 }), t.template.fields, values),
  );
  const lines = [...new Set(plain.map((y) => y.toFixed(2)))];
  assert.ok(lines.length >= 3, `expected a wrapped paragraph, got ${lines.length} line(s)`);
  assert.ok(Math.abs(Number(lines[0]) - Number(lines[1]) - 15) < 0.01); // 10 pt × 1.5
  // (in PDF space everything moves up with the box: 7.8 pt higher)
  plain.forEach((y, i) => assert.ok(Math.abs(offset[i] - 7.8 - y) < 0.01));
});

test('stampSignature writes the signing date on a design’s Date line', async () => {
  const box = { page: 0, x: 60, y: 700, width: 160, height: 20 };
  const signedAt = new Date('2026-10-02T05:30:00Z');
  const opts = { signerName: 'Priya Sharma', signedAt };
  const without = await textYs(await stampSignature(await blankPdf(), box, PNG_BYTES, opts));
  const withDate = await textYs(
    await stampSignature(
      await blankPdf(),
      { ...box, dateX: 450, dateY: 705, noteX: 60, noteY: 740 },
      PNG_BYTES,
      opts,
    ),
  );
  assert.equal(without.length, 1); // just the "Signed electronically" note
  assert.equal(withDate.length, 2); // the note and the date
  assert.ok(Math.abs(withDate[0] - (A4.height - 740)) < 0.01); // note moved to noteY
});

test('the default Nura templates all validate against their PDFs', async () => {
  const fs = await import('fs');
  for (const { file, data } of TEMPLATES) {
    const bytes = fs.readFileSync(new URL(`../../assets/hr-templates/${file}`, import.meta.url));
    const r = parseTemplate(data, await pdfPages(bytes));
    assert.equal(r.error, undefined, `${data.name}: ${r.error}`);
    if (data.requiresSignature) {
      assert.equal(r.template.signatureBox.page, 1);
      assert.ok(r.template.signatureBox.dateX > 0);
    }
  }
});

test('an optional field is not asked for; a long paragraph eases down to its maxLines', async () => {
  const t = parseTemplate(
    {
      name: 'Opt',
      kind: 'fixed',
      fields: [
        {
          key: 'text',
          text: '{{address}}\n{{email}}',
          optional: true,
          page: 0,
          x: 40,
          y: 80,
          width: 300,
          fontSize: 9,
        },
        {
          key: 'text',
          text: `This is to certify that **{{fullName}}** has completed an internship as **{{designation}}**.`,
          wrap: true,
          maxLines: 2,
          page: 0,
          x: 40,
          y: 120,
          width: 420,
          fontSize: 10,
        },
      ],
    },
    [A4],
  );
  assert.equal(t.error, undefined);
  const { missing } = resolveValues(t.template, {
    email: 'a@b.co',
    fullName: 'X',
    designation: 'Y',
    firstName: 'X', // used by the default email text
    companyName: 'The Nura Care',
  });
  assert.deepEqual(missing, []); // address is optional
  const long = {
    email: 'a@b.co',
    fullName: 'Venkata Satya Lakshmi Priyadarshini Subramaniam-Raghunathan',
    designation: 'Senior Product Design Intern',
  };
  const ys = await textYs(await fillFixed(await blankPdf(), t.template.fields, long));
  // one line for the email, then the paragraph: at most 2 distinct lines
  const paraLines = new Set(ys.slice(1).map((y) => y.toFixed(1)));
  assert.ok(paraLines.size <= 2, `paragraph took ${paraLines.size} lines`);
});
