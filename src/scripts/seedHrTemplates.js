/* eslint-disable no-console -- CLI script output */
// Adds The Nura Care's four default HR templates to People & letters, built
// from the Canva designs and exported to src/assets/hr-templates/:
//
//   Internship offer letter        the 2-page Canva letter, fixed; collects the
//                                  intern's signature in the acceptance box
//   Internship completion letter   the Canva letter, fixed
//   Experience letter              the plain letterhead, text laid out on it
//   Internship certificate         the Canva certificate, fixed
//
// The offer and completion PDFs are the Canva originals with the sample
// person's details redacted (the text is removed, not painted over); every
// heading, table rule, box, stamp and signature stays as designed. Fields
// write the person's details back into those exact spots, in the design's
// own fonts (Arimo / Cormorant Garamond) and colours.
//
//   node src/scripts/seedHrTemplates.js            # dry run: validates, lists what it would do
//   node src/scripts/seedHrTemplates.js --apply    # adds the ones that aren't there yet
//   node src/scripts/seedHrTemplates.js --update   # also replaces existing ones of the same
//                                                  # name (PDF + fields; documents already sent
//                                                  # keep their own copy)
//
// Each goes through the same pdfPages() / parseTemplate() as the Admin
// Workspace upload.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import HrTemplate from '../models/HrTemplate.js';
import HrFile from '../models/HrFile.js';
import { parseTemplate } from '../utils/hrValues.js';
import { pdfPages } from '../utils/hrPdf.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'hr-templates');
const NAVY = '#1B2E5A';
const PINK = '#D9607E';
const INK = '#2C2F36';
const MUTED = '#6B7280';

// Field y is the top of the text. Positions below are the baselines measured
// in the Canva PDFs (with PyMuPDF), turned into tops with each font's ascent
// plus a per-font correction found by rendering and re-measuring.
const ASCENT = { sans: 0.9053, serif: 0.924 };
const SHIFT = { sans: 2.22, serif: 0 };
const top = (baseline, size, font = 'sans') =>
  Math.round((baseline + SHIFT[font] - ASCENT[font] * size) * 100) / 100;

/** One line of text at a measured baseline. */
const line = (id, text, baseline, opts = {}) => {
  const { size = 9.38, font = 'sans', page = 0, x = 46.5, width = 502.7 } = opts;
  return {
    id,
    key: 'text',
    text,
    page,
    x,
    y: top(baseline, size, font),
    width,
    fontSize: size,
    font,
    bold: opts.bold ?? false,
    color: opts.color ?? INK,
    align: opts.align ?? 'left',
    ...(opts.lineHeight ? { lineHeight: opts.lineHeight } : {}),
  };
};

/** A paragraph that wraps, with **bold** runs in navy, like the Canva body text. */
const para = (id, text, baseline, opts = {}) => ({
  ...line(id, text, baseline, opts),
  wrap: true,
  lineHeight: opts.lineHeight ?? 1.68, // 15.76 pt at 9.38 pt
  boldColor: NAVY,
});

/** A value in a "key terms" table row (label column stays as designed). */
const cell = (id, text, baseline, opts = {}) =>
  line(id, text, baseline, { size: 8.63, x: 159.1, width: 390, ...opts });

const HEADER_REF = (text) =>
  line('ref', text, 120.78, { size: 7.88, color: MUTED, x: 349, width: 200, align: 'right' });

export const TEMPLATES = [
  {
    file: 'offer-letter.pdf',
    data: {
      name: 'Internship offer letter',
      category: 'offer_letter',
      kind: 'fixed',
      requiresSignature: true,
      // Acceptance box, page 2: the signature sits on the "Signature" rule,
      // the name is pre-filled on "Name" and the signing date goes on "Date".
      signatureBox: {
        page: 1,
        x: 62.3,
        y: 555.5,
        width: 174,
        height: 18.5,
        dateX: 452.9,
        dateY: top(568.3, 8.63),
        noteX: 62.3,
        noteY: 594,
      },
      fields: [
        HEADER_REF('Ref: {{documentNumber}}  ·  {{today}}'),
        line('title', 'Offer of Internship — {{designation}}', 152.4, {
          size: 19.51,
          font: 'serif',
          color: NAVY,
        }),
        line('name', '{{fullName}}', 181.8, { bold: true, color: NAVY, width: 350 }),
        line('contact', '{{address}}\n{{email}}', 198.49, {
          size: 8.63,
          color: MUTED,
          width: 350,
          lineHeight: 1.651, // 14.25 pt, as designed
        }),
        line('greeting', 'Dear {{fullName}},', 258.28),
        para(
          'intro',
          'Congratulations, and welcome. Following your application and interview, we are delighted to offer you an internship at **{{companyName}}** as {{designation}}. We were genuinely impressed by your curiosity and the care you bring to your work — both of which matter a great deal here.',
          284.54,
        ),
        cell('position', '{{designation}}', 371.01, { bold: true, color: NAVY }),
        cell('department', '{{department}}', 396.75),
        cell('duration', '{{custom.duration}}', 422.5),
        cell('hours', '{{custom.workingHours}}', 448.24),
        cell('location', '{{location}}', 473.98),
        cell('reportingTo', '{{managerName}}', 499.73),
        line('ref2', 'Ref: {{documentNumber}}', 83.62, {
          page: 1,
          size: 7.88,
          bold: true,
          color: NAVY,
          x: 349,
          width: 200,
          align: 'right',
        }),
        line(
          'notice',
          'This internship is a learning engagement and does not constitute employment. Either party may end it with 7 days’',
          335.17,
          { page: 1 },
        ),
        para(
          'acceptBy',
          'please sign and return a copy of this letter by **{{custom.acceptBy}}**.',
          394.44,
          { page: 1 },
        ),
        line('acceptName', '{{fullName}}', 568.3, {
          page: 1,
          size: 8.63,
          x: 257.6,
          width: 174,
        }),
      ],
      emailSubject: 'Your internship offer from {{companyName}}',
      emailBody: `Hi {{firstName}},

Congratulations! We're delighted to offer you the role of {{designation}} at {{companyName}}. Your offer letter is attached.

Please read it and sign it online using the button below.

Warm regards,
{{managerName}}
{{companyName}}`,
    },
  },
  {
    file: 'completion-letter.pdf',
    data: {
      name: 'Internship completion letter',
      category: 'internship_completion',
      kind: 'fixed',
      fields: [
        HEADER_REF('Ref: {{documentNumber}}  ·  {{today}}'),
        para(
          'certify',
          'This is to certify that **{{fullName}}** has successfully completed an internship with **{{companyName}}** as **{{designation}}** from **{{startDate}}** to **{{endDate}}**.',
          196.66,
        ),
        cell('internName', '{{fullName}}', 239.6, { bold: true, color: NAVY }),
        cell('position', '{{designation}}, {{department}}', 265.34),
        cell('period', '{{startDate}} – {{endDate}}  ·  {{custom.duration}}', 291.09),
        cell('mode', '{{location}}', 316.84),
        cell('mentor', '{{managerName}}', 342.58),
        line('scopeIntro', 'During the internship, {{firstName}} contributed to:', 400.49),
        line('scope1', '{{custom.scope1}}', 420.74, { x: 60, width: 489 }),
        line('scope2', '{{custom.scope2}}', 436.5, { x: 60, width: 489 }),
        line('scope3', '{{custom.scope3}}', 452.26, { x: 60, width: 489 }),
        para(
          'conduct',
          'Throughout the internship {{firstName}} was {{custom.conduct}}, worked well with the team, and handled sensitive information with the discretion our work requires. We rate the overall performance as **{{custom.rating}}**.',
          503.36,
        ),
        para(
          'thanks',
          'We thank {{firstName}} for the contribution made to {{companyName}} and wish {{firstName}} every success in the years ahead.',
          562.63,
        ),
      ],
      emailSubject: 'Your internship completion letter from {{companyName}}',
      emailBody: `Hi {{firstName}},

Thank you for your work with us as {{designation}}. Your internship completion letter is attached.

We wish you every success ahead.

Warm regards,
{{companyName}}`,
    },
  },
  {
    file: 'letterhead.pdf',
    data: {
      name: 'Experience letter',
      category: 'experience_letter',
      kind: 'letterhead',
      // Body area below the masthead rule, above the signature, stamp and
      // contact bar; the Canva letters' own type size and spacing.
      layout: {
        marginTop: 120,
        marginLeft: 46.5,
        marginRight: 46.5,
        marginBottom: 175,
        fontSize: 9.38,
        lineHeight: 1.68,
        font: 'sans',
      },
      body: `Date: {{today}}
Ref: {{documentNumber}}

**TO WHOMSOEVER IT MAY CONCERN**

This is to certify that **{{fullName}}** worked with **{{companyName}}** as **{{designation}}** ({{department}}) from **{{startDate}}** to **{{endDate}}**.

During this period {{firstName}} was sincere, dependable and a valued member of the team, and handled every responsibility with care and professionalism.

We wish {{firstName}} every success in the future.

For {{companyName}},`,
      emailSubject: 'Your experience letter from {{companyName}}',
      emailBody: `Hi {{firstName}},

Please find your experience letter from {{companyName}} attached. Thank you for everything you did here.

Warm regards,
{{companyName}}`,
    },
  },
  {
    file: 'certificate.pdf',
    data: {
      name: 'Internship certificate',
      category: 'certificate',
      kind: 'fixed',
      // Landscape Letter; the name and sentence are centred on the page.
      fields: [
        line('name', '{{fullName}}', 336.72, {
          size: 39,
          font: 'serif',
          color: PINK,
          x: 96,
          width: 600,
          align: 'center',
        }),
        para(
          'sentence',
          'for successfully completing an internship as **{{designation}}** at {{companyName}} from **{{startDate}}** to **{{endDate}}**, demonstrating dedication, professionalism and care throughout.',
          376.41,
          { size: 9.75, x: 158, width: 476, align: 'center', lineHeight: 1.692 },
        ),
        line('ref', 'Ref: {{documentNumber}}', 528.29, {
          size: 9,
          bold: true,
          color: NAVY,
          x: 547,
          width: 200,
        }),
        line('issued', 'Issued {{today}}', 540.4, {
          size: 8.25,
          color: MUTED,
          x: 547,
          width: 200,
        }),
      ],
      emailSubject: 'Your internship certificate from {{companyName}}',
      emailBody: `Hi {{firstName}},

Congratulations on completing your internship as {{designation}}! Your certificate is attached.

Warm regards,
{{companyName}}`,
    },
  },
];

const main = async () => {
  const update = process.argv.includes('--update');
  const apply = update || process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const existing = new Map(
      (await HrTemplate.find().select('name file').lean()).map((t) => [t.name, t]),
    );
    console.log(`db: ${mongoose.connection.name}`);
    for (const { file, data } of TEMPLATES) {
      const current = existing.get(data.name);
      if (current && !update) {
        console.log(`  = ${data.name} (already there, skipped; --update replaces it)`);
        continue;
      }
      const bytes = fs.readFileSync(path.join(DIR, file));
      const pages = await pdfPages(bytes);
      const parsed = parseTemplate(data, pages);
      if (parsed.error) throw new Error(`${data.name}: ${parsed.error}`);
      console.log(
        `  ${current ? '~' : '+'} ${data.name} (${data.kind}, ${pages.length} page${pages.length > 1 ? 's' : ''}, ${parsed.template.fields.length} fields)`,
      );
      if (!apply) continue;
      const stored = await HrFile.create({
        purpose: 'template',
        fileName: file,
        size: bytes.length,
        data: bytes,
      });
      const doc = { ...parsed.template, file: stored._id, fileName: file, pages };
      if (current) {
        await HrTemplate.updateOne({ _id: current._id }, { $set: doc });
        // Sent documents copy the PDF they were made from, so the old
        // template file is no longer referenced.
        await HrFile.deleteOne({ _id: current.file, purpose: 'template' });
      } else {
        await HrTemplate.create(doc);
      }
    }
    if (!apply) console.log('Dry run: nothing written. Re-run with --apply (or --update).');
  } finally {
    await mongoose.disconnect();
  }
};

// Only when run as a script, so tests and render checks can import TEMPLATES.
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
