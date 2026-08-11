/**
 * Seed data for Government Schemes & Benefits.
 *
 * Scope: women's reproductive & menstrual health only. Central + Rajasthan for
 * the first release; the schema is state-independent so more states are just
 * more documents. Every entry is verified against an official government source
 * (see `source` / `officialUrl`) and stamped with `lastVerifiedAt`.
 *
 * lastVerifiedAt reflects the date the details below were checked against the
 * official source. Update it whenever a scheme's details are re-verified.
 */

const VERIFIED_AT = new Date('2026-08-10T00:00:00.000Z');

export const governmentBenefitData = [
  /* ─────────────── CENTRAL ─────────────── */
  {
    name: 'Pradhan Mantri Matru Vandana Yojana',
    slug: 'pmmvy',
    shortName: 'PMMVY',
    type: 'scheme',
    governmentLevel: 'central',
    state: null,
    categories: ['maternity_postpartum', 'maternal_nutrition', 'pregnancy_antenatal'],
    description:
      'A maternity benefit programme providing a conditional cash transfer to pregnant and lactating women for their first living child, and an additional benefit for a second child if the child is a girl — to partly compensate for wage loss and support better nutrition and health.',
    benefits: [
      '₹5,000 in instalments for the first living child (on early ANC registration and child immunisation)',
      '₹6,000 for the second child if the child is a girl',
      'Amount is paid directly into the mother’s bank/post office account (DBT)',
    ],
    eligibility: [
      {
        text: 'Pregnant and lactating women (excluding those in regular government/PSU employment)',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
      { text: 'For the first living child (second child benefit applies only if it is a girl)' },
      { text: 'Aadhaar and a bank/post office account in the mother’s name are required' },
    ],
    documents: [
      'Aadhaar card (mother & husband)',
      'MCP (Mother-Child Protection) card',
      'Bank/post office passbook',
      'Filled application form (1A/1B/1C)',
    ],
    actionType: 'APPLY',
    applicationMethod:
      'Register at the nearest Anganwadi Centre / approved health facility, or online via the PMMVY portal (Citizen login).',
    applicationSteps: [
      {
        title: 'Register early',
        detail:
          'Register the pregnancy at the Anganwadi Centre or health facility as soon as possible.',
      },
      {
        title: 'Submit forms',
        detail: 'Submit the maternity benefit form with Aadhaar, MCP card and bank details.',
      },
      {
        title: 'Complete conditions',
        detail: 'Complete ANC check-up and child immunisation to unlock each instalment.',
      },
    ],
    whereToGet:
      'Anganwadi Centre (AWC) or approved health facility; ASHA/Anganwadi worker assists.',
    officialUrl: 'https://pmmvy.wcd.gov.in/',
    source: 'Ministry of Women & Child Development, Government of India',
    helpline: '104 / 011-23382393',
    order: 10,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Janani Suraksha Yojana',
    slug: 'jsy',
    shortName: 'JSY',
    type: 'scheme',
    governmentLevel: 'central',
    state: null,
    categories: ['maternity_postpartum', 'pregnancy_antenatal', 'mother_newborn_care'],
    description:
      'A safe-motherhood intervention under the National Health Mission that promotes institutional delivery among poor pregnant women by giving cash assistance for delivering in a government or accredited health facility.',
    benefits: [
      'Cash assistance on institutional delivery (higher amounts in Low Performing States)',
      'Rural: up to ₹1,400 (LPS) / ₹700 (HPS); Urban: up to ₹1,000 (LPS) / ₹600 (HPS)',
      'ASHA gets a package for facilitating the delivery',
    ],
    eligibility: [
      {
        text: 'Pregnant women opting for institutional (facility) delivery',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
      {
        text: 'In Low Performing States all pregnant women are eligible; in High Performing States, BPL/SC/ST women',
      },
    ],
    documents: [
      'JSY card / MCP card',
      'Aadhaar card',
      'Bank account details',
      'BPL certificate (where applicable)',
    ],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Deliver at a government or accredited health facility; the ASHA and facility staff process the JSY benefit.',
    whereToGet: 'Government hospital / accredited private facility; ASHA worker facilitates.',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=3&sublinkid=841&lid=309',
    source: 'National Health Mission, Ministry of Health & Family Welfare',
    helpline: '104',
    order: 20,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Janani Shishu Suraksha Karyakram',
    slug: 'jssk',
    shortName: 'JSSK',
    type: 'entitlement',
    governmentLevel: 'central',
    state: null,
    categories: ['maternity_postpartum', 'mother_newborn_care', 'pregnancy_antenatal'],
    description:
      'An entitlement for every pregnant woman and sick newborn to completely free and cashless services in public health institutions — including free delivery (normal and caesarean), drugs, diagnostics, diet, blood and transport.',
    benefits: [
      'Free delivery (including caesarean) in public health institutions',
      'Free drugs, consumables, diagnostics, diet and blood',
      'Free transport (home → facility, referral, and drop-back)',
      'Same free entitlements for sick newborns and infants up to 1 year',
    ],
    eligibility: [
      {
        text: 'All pregnant women delivering in public health institutions',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
      { text: 'All sick newborns and infants up to 1 year accessing public health facilities' },
    ],
    documents: ['No cost involved; carry MCP card if available'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'No application — it is a free entitlement at any government health facility. Visit the nearest government hospital.',
    whereToGet: 'Any government / public health institution (PHC, CHC, District Hospital).',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=3&sublinkid=842&lid=308',
    source: 'National Health Mission, Ministry of Health & Family Welfare',
    helpline: '104',
    order: 30,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Pradhan Mantri Surakshit Matritva Abhiyan',
    slug: 'pmsma',
    shortName: 'PMSMA',
    type: 'programme',
    governmentLevel: 'central',
    state: null,
    categories: ['pregnancy_antenatal', 'maternity_postpartum'],
    description:
      'Provides fixed-day, free and assured comprehensive antenatal care to pregnant women on the 9th of every month at government health facilities, to detect and manage high-risk pregnancies.',
    benefits: [
      'Free antenatal check-up on the 9th of every month',
      'Free diagnostics (blood, urine, ultrasound where available)',
      'Identification and follow-up of high-risk pregnancies',
    ],
    eligibility: [
      {
        text: 'Pregnant women in their 2nd or 3rd trimester',
        field: 'isPregnant',
        operator: 'eq',
        value: true,
      },
    ],
    documents: ['MCP card', 'Any previous ANC records'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Visit the designated government health facility on the 9th of any month — no registration fee.',
    whereToGet: 'Designated government health facilities (PHC/CHC/DH) on the 9th of every month.',
    officialUrl: 'https://pmsma.mohfw.gov.in/',
    source: 'Ministry of Health & Family Welfare, Government of India',
    helpline: '104',
    order: 40,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Surakshit Matritva Aashwasan (SUMAN)',
    slug: 'suman',
    shortName: 'SUMAN',
    type: 'programme',
    governmentLevel: 'central',
    state: null,
    categories: ['maternity_postpartum', 'pregnancy_antenatal', 'mother_newborn_care'],
    description:
      'Assured, dignified, respectful and quality healthcare at no cost, and zero tolerance for denial of services, for every woman and newborn visiting a public health facility — covering antenatal, delivery, postnatal and newborn care.',
    benefits: [
      'Free antenatal, delivery and postnatal care',
      'Free care for newborns and sick infants up to 6 months',
      'Zero-cost, zero-denial services with assured referral and transport',
    ],
    eligibility: [
      {
        text: 'All pregnant women, mothers up to 6 months post-delivery, and all sick newborns',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
    ],
    documents: ['MCP card (if available)'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Avail free services at any government health facility offering SUMAN — no application required.',
    whereToGet: 'Public health facilities designated under SUMAN.',
    officialUrl: 'https://suman.mohfw.gov.in/',
    source: 'Ministry of Health & Family Welfare, Government of India',
    helpline: '104',
    order: 50,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Rashtriya Kishor Swasthya Karyakram',
    slug: 'rksk',
    shortName: 'RKSK',
    type: 'programme',
    governmentLevel: 'central',
    state: null,
    categories: ['adolescent_health', 'sexual_reproductive_health', 'menstrual_hygiene'],
    description:
      'A national adolescent health programme (ages 10–19) covering nutrition, sexual and reproductive health, mental health, injuries and violence, substance misuse, and non-communicable diseases — delivered through peer educators and Adolescent Friendly Health Clinics.',
    benefits: [
      'Adolescent Friendly Health Clinics (AFHC) offering counselling and services',
      'Peer educator support and community outreach',
      'Sexual & reproductive health, nutrition and menstrual health guidance',
    ],
    eligibility: [
      { text: 'Adolescents aged 10–19 years', field: 'age', operator: 'lte', value: 19 },
    ],
    documents: ['No documents needed for counselling/services'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Visit an Adolescent Friendly Health Clinic (AFHC) at a government facility, or connect through a school/peer educator.',
    whereToGet: 'Adolescent Friendly Health Clinics at PHC/CHC/DH; school health programmes.',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=2&sublinkid=818&lid=221',
    source: 'National Health Mission, Ministry of Health & Family Welfare',
    helpline: '104',
    order: 60,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Menstrual Hygiene Scheme (Sanitary Napkins for Adolescent Girls)',
    slug: 'menstrual-hygiene-scheme',
    shortName: 'MHS',
    type: 'scheme',
    governmentLevel: 'central',
    state: null,
    categories: ['menstrual_hygiene', 'adolescent_health'],
    description:
      'Promotes menstrual hygiene among adolescent girls (10–19 years), especially in rural areas, by ensuring access to and use of high-quality sanitary napkins and raising awareness through ASHAs.',
    benefits: [
      'Subsidised, quality sanitary napkins for adolescent girls in rural areas',
      'Menstrual hygiene awareness and counselling by ASHA workers',
      'Safe disposal guidance',
    ],
    eligibility: [
      {
        text: 'Adolescent girls aged 10–19 years (focus on rural areas)',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
      { text: 'Age 10–19 years', field: 'age', operator: 'lte', value: 19 },
    ],
    documents: ['No documents required'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Access sanitary napkins and counselling through the local ASHA worker or sub-centre.',
    whereToGet: 'ASHA worker, sub-centre / Anganwadi in rural areas.',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=3&sublinkid=1021&lid=391',
    source: 'National Health Mission, Ministry of Health & Family Welfare',
    helpline: '104',
    order: 70,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Weekly Iron and Folic Acid Supplementation (WIFS)',
    slug: 'wifs',
    shortName: 'WIFS',
    type: 'programme',
    governmentLevel: 'central',
    state: null,
    categories: ['adolescent_health', 'maternal_nutrition', 'reproductive_health'],
    description:
      'A programme to reduce the prevalence and severity of anaemia in adolescent girls and boys (10–19 years) through weekly supervised Iron and Folic Acid tablets, biannual deworming and nutrition/health education.',
    benefits: [
      'Weekly supervised Iron-Folic Acid (IFA) tablet',
      'Biannual deworming',
      'Nutrition and anaemia awareness',
    ],
    eligibility: [
      {
        text: 'Adolescents aged 10–19 years (in-school and out-of-school)',
        field: 'age',
        operator: 'lte',
        value: 19,
      },
    ],
    documents: ['No documents required'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Provided through schools (Nodal teacher) and Anganwadi centres for out-of-school girls.',
    whereToGet: 'Schools and Anganwadi centres; ASHA for out-of-school adolescents.',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=3&sublinkid=1024&lid=394',
    source: 'National Health Mission, Ministry of Health & Family Welfare',
    helpline: '104',
    order: 80,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'ICDS Supplementary Nutrition (Anganwadi Services / POSHAN)',
    slug: 'icds-anganwadi-nutrition',
    shortName: 'ICDS',
    type: 'service',
    governmentLevel: 'central',
    state: null,
    categories: ['maternal_nutrition', 'pregnancy_antenatal', 'mother_newborn_care'],
    description:
      'Under Anganwadi Services (Saksham Anganwadi & POSHAN 2.0), pregnant women and lactating mothers receive supplementary nutrition, health check-ups, and nutrition & health education to improve maternal and child nutrition.',
    benefits: [
      'Supplementary nutrition (Take-Home Ration) for pregnant & lactating women',
      'Health check-ups and referral',
      'Nutrition & health education and counselling',
    ],
    eligibility: [
      {
        text: 'Pregnant women and lactating mothers',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
    ],
    documents: ['Aadhaar card', 'Registration at the local Anganwadi'],
    actionType: 'FIND_FACILITY',
    applicationMethod: 'Register at the nearest Anganwadi Centre to receive services.',
    whereToGet: 'Anganwadi Centre (AWC).',
    officialUrl: 'https://wcd.nic.in/schemes/anganwadi-services-under-umbrella-icds',
    source: 'Ministry of Women & Child Development, Government of India',
    helpline: '1800-11-2233 (POSHAN)',
    order: 90,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'National Family Planning Programme',
    slug: 'family-planning',
    shortName: 'FP',
    type: 'service',
    governmentLevel: 'central',
    state: null,
    categories: ['family_planning', 'sexual_reproductive_health', 'reproductive_health'],
    description:
      'Free contraceptive choices and counselling through public health facilities — including condoms, oral pills, the weekly pill Chhaya, injectable contraceptive Antara, IUCD/PPIUCD, and sterilisation — with compensation for sterilisation acceptors.',
    benefits: [
      'Free basket of contraceptives (condoms, OCPs, Chhaya, Antara, IUCD/PPIUCD)',
      'Free counselling on spacing and limiting methods',
      'Compensation scheme for sterilisation acceptors',
    ],
    eligibility: [{ text: 'Eligible couples of reproductive age seeking contraception' }],
    documents: ['ID proof for sterilisation/compensation (Aadhaar)'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Visit any government health facility or ASHA for free contraceptives and counselling.',
    whereToGet: 'Sub-centre / PHC / CHC / District Hospital; ASHA worker.',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=2&sublinkid=821&lid=222',
    source: 'National Health Mission, Ministry of Health & Family Welfare',
    helpline: '1800-116-555 (Family Planning)',
    order: 100,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Postpartum Family Planning (PPFP)',
    slug: 'postpartum-family-planning',
    shortName: 'PPFP',
    type: 'service',
    governmentLevel: 'central',
    state: null,
    categories: ['family_planning', 'maternity_postpartum', 'reproductive_health'],
    description:
      'Family planning services offered around the time of childbirth — including postpartum IUCD (PPIUCD), postpartum sterilisation and the injectable Antara — to help women space or limit pregnancies safely after delivery.',
    benefits: [
      'Free postpartum IUCD (PPIUCD) insertion',
      'Postpartum sterilisation services',
      'Counselling on healthy spacing after childbirth',
    ],
    eligibility: [
      {
        text: 'Women who have recently delivered or are about to deliver',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
    ],
    documents: ['MCP card / hospital record'],
    actionType: 'FIND_FACILITY',
    applicationMethod: 'Ask for PPFP counselling and services at the delivery facility.',
    whereToGet: 'Government delivery facility (PHC/CHC/DH).',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=2&sublinkid=821&lid=222',
    source: 'National Health Mission, Ministry of Health & Family Welfare',
    helpline: '1800-116-555',
    order: 110,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Comprehensive Abortion Care (Safe Abortion Services)',
    slug: 'comprehensive-abortion-care',
    shortName: 'CAC',
    type: 'service',
    governmentLevel: 'central',
    state: null,
    categories: ['sexual_reproductive_health', 'reproductive_health'],
    description:
      'Safe and legal abortion (Medical Termination of Pregnancy) services and post-abortion care and contraception at approved government facilities, in line with the MTP Act. Services are confidential.',
    benefits: [
      'Safe, legal MTP services at approved facilities',
      'Post-abortion care and contraception counselling',
      'Confidential care',
    ],
    eligibility: [
      {
        text: 'Women seeking a legal termination of pregnancy under the MTP Act',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
    ],
    documents: ['Consent form; ID as required by facility'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Consult a government-approved MTP facility or a Registered Medical Practitioner.',
    whereToGet: 'Approved government health facilities / certified providers.',
    officialUrl: 'https://nhm.gov.in/index1.php?lang=1&level=2&sublinkid=821&lid=222',
    source: 'Ministry of Health & Family Welfare, Government of India',
    helpline: '104',
    order: 120,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },

  /* ─────────────── RAJASTHAN ─────────────── */
  {
    name: 'Mukhyamantri Rajshri Yojana',
    slug: 'rajasthan-mukhyamantri-rajshri-yojana',
    shortName: 'Rajshri',
    type: 'scheme',
    governmentLevel: 'state',
    state: 'Rajasthan',
    categories: ['mother_newborn_care', 'maternity_postpartum'],
    description:
      'A Rajasthan government scheme to promote the birth, health and wellbeing of the girl child. Benefits are paid in instalments to the family of a girl born in a government/JSY-accredited facility, beginning at birth and linked to immunisation and schooling milestones.',
    benefits: [
      '₹2,500 at the birth of a girl child (in a government/accredited institution)',
      '₹2,500 on completion of one year and full immunisation',
      'Further instalments linked to schooling milestones (total up to ₹50,000)',
    ],
    eligibility: [
      {
        text: 'Girl child born in a government or JSY-accredited health facility in Rajasthan',
        field: 'state',
        operator: 'eq',
        value: 'Rajasthan',
      },
      { text: 'Parents must be residents of Rajasthan with required documents' },
    ],
    documents: [
      'Aadhaar (parents & child)',
      'Bhamashah/Jan Aadhaar card',
      'Birth certificate',
      'Bank account details',
      'Institutional delivery proof',
    ],
    actionType: 'APPLY',
    applicationMethod:
      'The delivery facility registers the first instalment; subsequent instalments are claimed with the required documents.',
    applicationSteps: [
      {
        title: 'Institutional delivery',
        detail: 'Deliver at a government or accredited facility in Rajasthan.',
      },
      {
        title: 'First instalment',
        detail: 'Facility records the birth and processes the first benefit.',
      },
      {
        title: 'Follow-up claims',
        detail: 'Claim later instalments on immunisation and schooling milestones.',
      },
    ],
    whereToGet: 'Delivery facility / Medical & Health Department, Government of Rajasthan.',
    officialUrl: 'https://rajswasthya.nic.in/',
    source: 'Medical, Health & Family Welfare Department, Government of Rajasthan',
    helpline: '104 / 108',
    order: 200,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Mukhyamantri Rajshri / Matritva Poshan — Nutrition Support',
    slug: 'rajasthan-mukhyamantri-matritva-poshan-yojana',
    shortName: 'Matritva Poshan',
    type: 'scheme',
    governmentLevel: 'state',
    state: 'Rajasthan',
    categories: ['maternal_nutrition', 'pregnancy_antenatal', 'maternity_postpartum'],
    description:
      'A Rajasthan initiative to improve the nutrition of pregnant women and lactating mothers, providing nutritional support/supplementary nutrition to reduce maternal anaemia and low birth weight, delivered through health and ICDS platforms.',
    benefits: [
      'Nutritional support for pregnant and lactating mothers',
      'Focus on reducing maternal anaemia and low birth weight',
      'Delivered via health facilities and Anganwadi centres',
    ],
    eligibility: [
      {
        text: 'Pregnant women and lactating mothers resident in Rajasthan',
        field: 'state',
        operator: 'eq',
        value: 'Rajasthan',
      },
      { text: 'Female', field: 'gender', operator: 'eq', value: 'female' },
    ],
    documents: ['Jan Aadhaar card', 'Aadhaar card', 'MCP card', 'Bank account details'],
    actionType: 'CHECK_ELIGIBILITY',
    applicationMethod:
      'Enrol through the ANM/ASHA at the local health facility or Anganwadi centre.',
    whereToGet: 'PHC/CHC and Anganwadi centres in Rajasthan; ANM/ASHA worker.',
    officialUrl: 'https://rajswasthya.nic.in/',
    source: 'Medical, Health & Family Welfare Department, Government of Rajasthan',
    helpline: '104',
    order: 210,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Udaan — Free Sanitary Napkin Scheme (Kalibai Bheel)',
    slug: 'rajasthan-udaan-sanitary-napkin-scheme',
    shortName: 'Udaan',
    type: 'scheme',
    governmentLevel: 'state',
    state: 'Rajasthan',
    categories: ['menstrual_hygiene', 'adolescent_health'],
    description:
      'The Rajasthan Government’s “Udaan” initiative provides free sanitary napkins to girls and women to promote menstrual hygiene and dignity, distributed through schools, Anganwadi centres and health facilities across the state.',
    benefits: [
      'Free sanitary napkins for girls and women',
      'Menstrual hygiene awareness and dignity focus',
      'Distributed via schools, Anganwadi and health facilities',
    ],
    eligibility: [
      {
        text: 'Girls and women resident in Rajasthan',
        field: 'gender',
        operator: 'eq',
        value: 'female',
      },
      { text: 'Resident of Rajasthan', field: 'state', operator: 'eq', value: 'Rajasthan' },
    ],
    documents: ['Jan Aadhaar (for verification, where required)'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Collect free sanitary napkins from the designated school, Anganwadi centre or health facility.',
    whereToGet: 'Government schools, Anganwadi centres and health facilities in Rajasthan.',
    officialUrl: 'https://wcd.rajasthan.gov.in/',
    source: 'Women & Child Development Department, Government of Rajasthan',
    helpline: '181 (Rajasthan Sampark)',
    order: 220,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
  {
    name: 'Rajasthan Maternal Health & ANC Services (NHM Rajasthan)',
    slug: 'rajasthan-maternal-health-anc-services',
    shortName: 'RJ-ANC',
    type: 'service',
    governmentLevel: 'state',
    state: 'Rajasthan',
    categories: ['pregnancy_antenatal', 'maternity_postpartum', 'mother_newborn_care'],
    description:
      'Free antenatal, delivery and postnatal care services delivered by the Medical & Health Department of Rajasthan under the National Health Mission, including free ANC check-ups, institutional delivery, and referral transport (108/104).',
    benefits: [
      'Free antenatal check-ups and diagnostics',
      'Free institutional delivery and postnatal care',
      'Free referral transport (108 ambulance) and 104 helpline support',
    ],
    eligibility: [
      {
        text: 'Pregnant women resident in Rajasthan',
        field: 'state',
        operator: 'eq',
        value: 'Rajasthan',
      },
      { text: 'Female', field: 'gender', operator: 'eq', value: 'female' },
    ],
    documents: ['MCP card', 'Jan Aadhaar / Aadhaar card'],
    actionType: 'FIND_FACILITY',
    applicationMethod:
      'Avail free services at any Rajasthan government health facility; no application needed.',
    whereToGet: 'Government health facilities across Rajasthan (Sub-centre/PHC/CHC/DH).',
    officialUrl: 'https://rajswasthya.nic.in/',
    source: 'Medical, Health & Family Welfare Department, Government of Rajasthan',
    helpline: '104 / 108',
    order: 230,
    lastVerifiedAt: VERIFIED_AT,
    isActive: true,
  },
];
