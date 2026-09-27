/* eslint-disable no-console -- CLI script output */
// Adds The Nura Care's four default HR templates to People & letters, built
// from the Canva designs ("… (Portal template)" copies in the team Canva,
// exported to src/assets/hr-templates/):
//
//   Internship offer letter        letterhead, 2 pages, collects a signature
//   Internship completion letter   letterhead
//   Experience letter              the plain letterhead
//   Internship certificate         fixed design with placed fields
//
//   node src/scripts/seedHrTemplates.js           # dry run: validates, lists what it would add
//   node src/scripts/seedHrTemplates.js --apply   # writes to MONGODB_URI
//
// Idempotent: a template whose name already exists is skipped. Each goes
// through the same pdfPages() / parseTemplate() as the Admin Workspace upload.
// Positions: Canva px × 0.75 = PDF points (794 px wide A4 = 595.5 pt).
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

// Body area of the A4 designs: below the masthead rule / title, above the
// founder signature and stamp (Canva y ≈ 890 px) and the contact bar.
const A4_LAYOUT = {
  marginLeft: 46.5,
  marginRight: 46.5,
  marginBottom: 175,
  fontSize: 9.5,
  lineHeight: 1.6,
  font: 'sans',
};

export const TEMPLATES = [
  {
    file: 'offer-letter.pdf',
    data: {
      name: 'Internship offer letter',
      category: 'offer_letter',
      kind: 'letterhead',
      requiresSignature: true,
      layout: { ...A4_LAYOUT, marginTop: 135 },
      body: `Ref: {{documentNumber}}  ·  {{today}}

**Offer of Internship — {{designation}}**

**{{fullName}}**
{{address}}
{{email}}

Dear {{firstName}},

Congratulations, and welcome. Following your application and interview, we are delighted to offer you an internship at **{{companyName}}** as **{{designation}}**. We were genuinely impressed by your curiosity and the care you bring to your work — both of which matter a great deal here.

The key terms of your internship are set out below.

**Position:** {{designation}}
**Department:** {{department}}
**Duration:** {{custom.duration}}
**Working hours:** {{custom.workingHours}}
**Location:** {{location}}
**Reporting to:** {{managerName}}

**1 · HOURS AND PLACE OF WORK**
You are expected to be available during the hours stated above and to keep your mentor informed of your availability. Any change of schedule or planned leave should be agreed with your mentor in advance. Where the internship is remote, you are responsible for a stable internet connection and a workspace suitable for calls.

**2 · CONFIDENTIALITY**
During and after your internship you will keep confidential all non-public information you come across — patient and customer details, health records, business plans, pricing, code, designs and internal documents. Nothing may be copied, shared or published outside {{companyName}} without written permission. All work product created during the internship belongs to {{companyName}}.

**3 · CODE OF CONDUCT**
We work with people at vulnerable moments, so conduct matters as much as output. You agree to:
•  treat colleagues, clients and patients with respect, dignity and privacy;
•  represent {{companyName}} honestly and never give medical advice beyond your remit;
•  follow our data-handling, safety and social-media guidelines;
•  raise any concern or mistake early — we would always rather hear it than not.

This internship is a learning engagement and does not constitute employment. Either party may end it with 7 days' written notice; {{companyName}} may end it immediately for a breach of confidentiality or conduct.

We are very glad you are joining us, and we hope this is a period you look back on as genuinely useful. To accept, please sign below by **{{custom.acceptBy}}**.

Warm regards,

**ACCEPTANCE BY THE INTERN**
I have read and understood the terms above and accept the internship offered by {{companyName}}.`,
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
      kind: 'letterhead',
      layout: { ...A4_LAYOUT, marginTop: 188 },
      body: `Ref: {{documentNumber}}  ·  {{today}}

This is to certify that **{{fullName}}** has successfully completed an internship with **{{companyName}}** as **{{designation}}** from **{{startDate}}** to **{{endDate}}**.

**Intern name:** {{fullName}}
**Position held:** {{designation}}, {{department}}
**Period:** {{startDate}} – {{endDate}}
**Mode:** {{location}}
**Mentor:** {{managerName}}

**SCOPE OF WORK**
During the internship, {{firstName}} contributed to:
•  {{custom.scope1}}
•  {{custom.scope2}}
•  {{custom.scope3}}

**CONDUCT AND PERFORMANCE**
Throughout the internship {{firstName}} was {{custom.conduct}}, worked well with the team, and handled sensitive information with the discretion our work requires. We rate the overall performance as **{{custom.rating}}**.

We thank {{firstName}} for the contribution made to {{companyName}} and wish them every success in the years ahead.`,
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
      layout: { ...A4_LAYOUT, marginTop: 120 },
      body: `Date: {{today}}
Ref: {{documentNumber}}

**TO WHOMSOEVER IT MAY CONCERN**

This is to certify that **{{fullName}}** worked with **{{companyName}}** as **{{designation}}** in the {{department}} team from **{{startDate}}** to **{{endDate}}**.

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
      // Canva: name box 248–808 px at y 401 px; sentence 208–848 px at y 490 px;
      // ref / issued at x 729 px, y 693 / 711 px (landscape Letter, 1056 × 816 px).
      fields: [
        {
          id: 'name',
          key: 'fullName',
          page: 0,
          x: 186,
          y: 301,
          width: 420,
          fontSize: 36,
          font: 'serif',
          bold: true,
          color: PINK,
          align: 'center',
        },
        {
          id: 'line1',
          key: 'text',
          text: 'for successfully completing an internship as {{designation}} at {{companyName}}',
          page: 0,
          x: 156,
          y: 368,
          width: 480,
          fontSize: 10,
          font: 'sans',
          bold: false,
          color: INK,
          align: 'center',
        },
        {
          id: 'line2',
          key: 'text',
          text: 'from {{startDate}} to {{endDate}}, demonstrating dedication, professionalism and care throughout.',
          page: 0,
          x: 156,
          y: 385,
          width: 480,
          fontSize: 10,
          font: 'sans',
          bold: false,
          color: INK,
          align: 'center',
        },
        {
          id: 'ref',
          key: 'text',
          text: 'Ref: {{documentNumber}}',
          page: 0,
          x: 547,
          y: 520,
          width: 160,
          fontSize: 9,
          font: 'sans',
          bold: true,
          color: NAVY,
          align: 'left',
        },
        {
          id: 'issued',
          key: 'text',
          text: 'Issued {{today}}',
          page: 0,
          x: 547,
          y: 533.5,
          width: 160,
          fontSize: 8,
          font: 'sans',
          bold: false,
          color: MUTED,
          align: 'left',
        },
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
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const existing = new Set((await HrTemplate.find().select('name').lean()).map((t) => t.name));
    console.log(`db: ${mongoose.connection.name}`);
    for (const { file, data } of TEMPLATES) {
      if (existing.has(data.name)) {
        console.log(`  = ${data.name} (already there, skipped)`);
        continue;
      }
      const bytes = fs.readFileSync(path.join(DIR, file));
      const pages = await pdfPages(bytes);
      const parsed = parseTemplate(data, pages);
      if (parsed.error) throw new Error(`${data.name}: ${parsed.error}`);
      console.log(
        `  + ${data.name} (${data.kind}, ${pages.length} page${pages.length > 1 ? 's' : ''})`,
      );
      if (!apply) continue;
      const stored = await HrFile.create({
        purpose: 'template',
        fileName: file,
        size: bytes.length,
        data: bytes,
      });
      await HrTemplate.create({ ...parsed.template, file: stored._id, fileName: file, pages });
    }
    if (!apply) console.log('Dry run: nothing written. Re-run with --apply to add them.');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
