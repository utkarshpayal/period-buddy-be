import QuestionAnswer from '../models/QuestionAnswer.js';
import Doctor from '../models/Doctor.js';
import DoctorAvailability from '../models/DoctorAvailability.js';
import HealthIssue from '../models/HealthIssue.js';
import WellbeingResource from '../models/WellbeingResource.js';
import Blog from '../models/Blog.js';
import Reel from '../models/Reel.js';
import GovernmentBenefit from '../models/GovernmentBenefit.js';
import SubscriptionFeature from '../models/SubscriptionFeature.js';
import SubscriptionSettings from '../models/SubscriptionSettings.js';
import { governmentBenefitData } from './schemeSeedData.js';
import { subscriptionFeatureData } from './subscriptionSeedData.js';
import logger from './logger.js';
import { backfillLegacyDeletedAccounts } from './accountLifecycle.js';

const qaData = [
  {
    question: 'What is a normal menstrual cycle length?',
    slug: 'what-is-a-normal-menstrual-cycle-length',
    answer:
      'A normal menstrual cycle ranges from 21 to 35 days, with the average being 28 days. Variation from month to month is also normal.',
    category: 'general',
    tags: ['cycle', 'menstruation', 'basics'],
  },
  {
    question: 'What are common PMS symptoms?',
    slug: 'what-are-common-pms-symptoms',
    answer:
      'Common PMS symptoms include bloating, breast tenderness, mood swings, irritability, fatigue, headaches, and food cravings. These typically occur 1–2 weeks before your period.',
    category: 'symptoms',
    tags: ['PMS', 'symptoms'],
  },
  {
    question: 'When is my fertile window?',
    slug: 'when-is-my-fertile-window',
    answer:
      'Your fertile window is typically 5 days before ovulation and the day of ovulation itself. Ovulation usually occurs around day 14 of a 28-day cycle, but varies.',
    category: 'fertility',
    tags: ['fertility', 'ovulation'],
  },
  {
    question: 'What is PCOS?',
    slug: 'what-is-pcos',
    answer:
      'Polycystic Ovary Syndrome (PCOS) is a common hormonal condition. It is usually diagnosed when 2 of these 3 are present: irregular or missed periods, signs of high androgens (extra hair growth, acne, or a blood test), and many small follicles on an ultrasound. These “cysts” are really follicles, and not everyone with PCOS has them. PCOS can also make it harder to get pregnant.',
    category: 'health',
    tags: ['PCOS', 'hormones'],
  },
  {
    question: 'How can I track my ovulation?',
    slug: 'how-can-i-track-my-ovulation',
    answer:
      'You can track ovulation using: 1) Basal Body Temperature (BBT), 2) Ovulation prediction kits, 3) Cervical mucus monitoring, 4) Calendar tracking apps like Period Buddy (these give estimates, not a guarantee).',
    category: 'tracking',
    tags: ['ovulation', 'tracking'],
  },
];

const doctorData = [
  {
    name: 'Dr. Sarah Johnson',
    specialty: 'Gynecologist',
    rating: 4.8,
    availability: 'Available today',
    pricePerSession: 45,
    currency: 'USD',
    avatarEmoji: '👩‍⚕️',
    bio: 'Board-certified OB/GYN with 12+ years experience in reproductive health.',
    languages: ['English', 'Spanish'],
  },
  {
    name: 'Dr. Priya Sharma',
    specialty: 'OBGYN Expert',
    rating: 4.9,
    availability: 'Tomorrow 2 PM',
    pricePerSession: 60,
    currency: 'USD',
    avatarEmoji: '👩‍⚕️',
    bio: 'Fellowship-trained OBGYN specializing in hormonal disorders and PCOS management.',
    languages: ['English', 'Hindi'],
  },
  {
    name: 'Dr. Maria Lopez',
    specialty: 'Reproductive Health',
    rating: 4.7,
    availability: 'Available today',
    pricePerSession: 50,
    currency: 'USD',
    avatarEmoji: '👩‍⚕️',
    bio: 'Reproductive endocrinologist with expertise in fertility preservation and cycle disorders.',
    languages: ['English', 'Portuguese'],
  },
  {
    name: 'Dr. Aisha Patel',
    specialty: 'Maternal-Fetal Medicine',
    rating: 4.9,
    availability: 'Monday 10 AM',
    pricePerSession: 75,
    currency: 'USD',
    avatarEmoji: '👩‍⚕️',
    bio: 'High-risk pregnancy specialist with 15 years of clinical experience.',
    languages: ['English', 'Gujarati'],
  },
];

const blogData = [
  {
    title: 'Understanding Your Hormonal Cycle',
    slug: 'understanding-your-hormonal-cycle',
    author: 'Dr. Sarah Chen',
    category: 'health',
    tags: ['cycle', 'hormones', 'tracking'],
    excerpt:
      'A practical guide to the four menstrual cycle phases, the mood and energy shifts each one brings, and how tracking helps you recognise your own pattern.',
    content: [
      'Your menstrual cycle is a monthly rhythm driven by four hormones — oestrogen, progesterone, luteinising hormone (LH) and follicle-stimulating hormone (FSH). It is easiest to understand in four phases.',
      '',
      '1. Menstrual phase (roughly days 1–5). Your period starts when oestrogen and progesterone drop and the uterine lining sheds. Some people feel low on energy, and resting is fine — it is not a sign of weakness.',
      '',
      '2. Follicular phase (roughly days 6–13). Oestrogen climbs as follicles mature. Some people notice more energy, clearer skin or a brighter mood, but this varies a lot from person to person.',
      '',
      '3. Ovulation (around day 14 in a 28-day cycle). LH surges and an egg is released. Some people notice higher libido, and cervical mucus becomes clear and stretchy.',
      '',
      '4. Luteal phase (roughly days 15–28). Progesterone rises then falls if there is no pregnancy. This is when PMS symptoms — bloating, tender breasts, cravings and mood changes — tend to appear.',
      '',
      'Everyone’s cycle is different, and phase lengths vary. The real value of tracking flow, mood, energy and symptoms over a few months is that you stop comparing yourself to a textbook 28-day cycle and start seeing your own pattern — which makes recurring changes far easier to plan around.',
    ].join('\n'),
    coverImageUrl:
      'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 8,
    isPublished: true,
    status: 'published',
    publishedAt: new Date(),
  },
  {
    title: 'PCOS and PCOD: What to Track and When to Seek Help',
    slug: 'pcos-and-pcod-what-to-track',
    author: 'Dr. Priya Sharma',
    category: 'health',
    tags: ['pcos', 'pcod', 'hormones'],
    excerpt:
      'Common signs of PCOS/PCOD, the symptoms worth logging, and the point at which it is sensible to bring them to a clinician.',
    content: [
      'Polycystic Ovary Syndrome (PCOS) and Polycystic Ovarian Disease (PCOD) are common hormonal conditions that affect how the ovaries work. They can influence period timing, skin, hair growth, weight and energy — but they look different from person to person.',
      '',
      'Signs worth paying attention to include: cycles that are consistently longer than 35 days or that skip months, persistent acne along the jaw and chin, new or increased hair growth on the face or body, hair thinning on the scalp, unexplained weight changes, and ongoing fatigue.',
      '',
      'What to log in Period Buddy: cycle-gap length, skin changes, hair changes, pain, mood and energy. A few months of this history turns a vague “something feels off” into a clear timeline you can show a clinician.',
      '',
      'When to seek help: if periods are regularly absent or very irregular, if acne or hair growth is distressing, or if you are trying to conceive without success. A clinician can check hormone levels and metabolic markers and discuss options — from lifestyle changes to medication. PCOS is manageable, and early tracking makes that conversation much more productive.',
    ].join('\n'),
    coverImageUrl:
      'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 12,
    isPublished: true,
    status: 'published',
    publishedAt: new Date(),
  },
  {
    title: 'Period Pain: What Helps, and What the Evidence Says',
    slug: 'period-pain-what-helps',
    author: 'Dr. Thara Nair',
    category: 'health',
    tags: ['cramps', 'pain', 'self-care'],
    excerpt:
      'Practical, evidence-backed ways to ease menstrual cramps — and the warning signs that mean pain is worth investigating.',
    content: [
      'Menstrual cramps (dysmenorrhoea) happen when the uterus contracts to shed its lining, driven by hormone-like chemicals called prostaglandins. For many people the pain is mild; for others it disrupts daily life.',
      '',
      'What tends to help: heat on the lower abdomen (a heat pack is as effective as many painkillers for some people), gentle movement and stretching, staying hydrated, and anti-inflammatory pain relief such as ibuprofen taken early — before pain peaks — if it is safe for you. Regular exercise across the month is linked to less severe cramps over time.',
      '',
      'What the evidence is softer on: many supplements are marketed for cramps, but the strongest signals are for magnesium and omega-3s in some studies. Treat these as “worth trying” rather than guaranteed.',
      '',
      'When to get checked: pain that stops you working or sleeping, pain that is getting worse month on month, pain with very heavy bleeding, or pain outside your period can point to conditions like endometriosis or fibroids. Track the severity and timing of your pain — that log is the single most useful thing to bring to an appointment.',
    ].join('\n'),
    coverImageUrl:
      'https://images.unsplash.com/photo-1512069772995-ec65ed45afd6?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 7,
    isPublished: true,
    status: 'published',
    publishedAt: new Date(),
  },
  {
    title: 'Eating With Your Cycle: A Simple, Non-Restrictive Guide',
    slug: 'eating-with-your-cycle',
    author: 'Maya Okafor, RD',
    category: 'lifestyle',
    tags: ['nutrition', 'energy', 'cycle'],
    excerpt:
      'How your appetite and energy needs shift across the month, and easy food choices that work with each phase rather than against it.',
    content: [
      '“Cycle syncing” your diet does not need to be complicated or restrictive. It is really about noticing that your body’s needs change across the month and responding kindly.',
      '',
      'During your period, iron is lost through bleeding, so iron-rich foods — leafy greens, lentils, beans, red meat if you eat it — paired with vitamin C help top you up. Warm, comforting meals are fine; this is not the week for punishing yourself.',
      '',
      'In the follicular and ovulation phases, some people feel more energetic. Protein and fresh produce are good choices any week, and if you have more energy it can be an easy time to cook and plan ahead.',
      '',
      'In the luteal phase, some people feel hungrier and crave carbohydrates or sweet foods before their period. Complex carbohydrates (oats, whole grains, fruit) and foods like nuts and seeds keep you fuller for longer than highly processed sugar. The goal is not perfection — just eating in a way that feels good.',
    ].join('\n'),
    coverImageUrl:
      'https://images.unsplash.com/photo-1490645935967-10de6ba17061?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 6,
    isPublished: true,
    status: 'published',
    publishedAt: new Date(),
  },
  {
    title: 'Tracking Your Cycle: How to Get Data You Can Actually Use',
    slug: 'tracking-your-cycle-useful-data',
    author: 'Period Buddy Team',
    category: 'general',
    tags: ['tracking', 'basics', 'getting-started'],
    excerpt:
      'A short guide to logging in a way that reveals patterns — without turning tracking into a daily chore.',
    content: [
      'The best tracking habit is the one you actually keep. You do not need to log everything every day for your data to be useful.',
      '',
      'Start with three things: the days you bleed and how heavy it is, your mood, and your energy. Those alone are enough to reveal your cycle length, your fertile window estimate, and the timing of PMS.',
      '',
      'Add detail when it matters to you. If you are investigating acne, log skin. If you get cramps, log pain severity. If you are trying to conceive, log cervical mucus and ovulation signs. Targeted logging beats logging everything and burning out.',
      '',
      'Give it time. One cycle tells you very little; three to four cycles start to show a pattern. In Period Buddy, days you have logged appear filled in, while predicted days show as a dashed outline — so you can always see the difference between what actually happened and what the app is forecasting.',
    ].join('\n'),
    coverImageUrl:
      'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 5,
    isPublished: true,
    status: 'published',
    publishedAt: new Date(),
  },
  {
    title: 'Sleep and Your Cycle: Why Rest Changes Across the Month',
    slug: 'sleep-and-your-cycle',
    author: 'Dr. Sarah Chen',
    category: 'lifestyle',
    tags: ['sleep', 'luteal', 'wellbeing'],
    excerpt:
      'Progesterone, body temperature and PMS all affect how you sleep. Here is what changes, and how to protect your rest.',
    content: [
      'If your sleep feels worse in the days before your period, you are not imagining it. Hormones that shift across the cycle also affect body temperature and sleep quality.',
      '',
      'After ovulation, rising progesterone nudges your core body temperature up by a few tenths of a degree. A warmer body can make it harder to fall and stay asleep, which is why the late luteal phase often feels restless.',
      '',
      'PMS symptoms — cramps, anxiety, bloating — add to this, and disrupted sleep in turn makes mood symptoms worse, creating a loop.',
      '',
      'What helps: keep the bedroom cool, especially in the luteal phase; hold a consistent sleep and wake time; get daylight in the morning; and ease off caffeine and alcohol in the second half of your cycle. Logging your sleep alongside your cycle in Period Buddy makes it obvious which phase disrupts your rest most — and lets you plan lighter days accordingly.',
    ].join('\n'),
    coverImageUrl:
      'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 6,
    isPublished: true,
    status: 'published',
    publishedAt: new Date(),
  },
];

const reelData = [
  {
    title: 'A Simple Overview of Hormonal Cycle Phases',
    creatorId: 'doc_sarah',
    creatorName: 'Dr. Sarah Chen (OBGYN & Cycle Expert)',
    creatorAvatar:
      'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?q=80&w=150&auto=format&fit=crop',
    duration: '0:15',
    category: 'Wellness',
    verified: true,
    thumbnailUrl:
      'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',
    directMp4Url:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    pollQuestion: 'Vote for the next video topic:',
    pollOptions: [
      { optionId: 'o1', topic: 'Stress, cortisol, and cycle changes', votes: 142 },
      { optionId: 'o2', topic: 'Menstrual cup cleaning and storage', votes: 98 },
    ],
  },
  {
    title: 'Gentle Yoga Movements for Period Pain Relief',
    creatorId: 'doc_thara',
    creatorName: 'Dr. Thara (Clinical Physiologist)',
    creatorAvatar:
      'https://images.unsplash.com/photo-1594824813573-246434e33963?q=80&w=150&auto=format&fit=crop',
    duration: '0:12',
    category: 'Self-Care',
    verified: true,
    thumbnailUrl:
      'https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=600&auto=format&fit=crop',
    directMp4Url:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    pollQuestion: 'What should the next quick video cover?',
    pollOptions: [
      { optionId: 'o3', topic: 'Understanding period bowel changes', votes: 215 },
      { optionId: 'o4', topic: 'PCOS-friendly food and routine basics', votes: 310 },
    ],
  },
];

const healthIssueData = [
  {
    title: 'PCOS / PCOD',
    category: 'Hormonal Equilibrium',
    icon: 'alert-circle-outline',
    color: '#ef4444',
    summary:
      'Polycystic Ovary Syndrome is a complex metabolic and endocrine disorder that can disrupt ovarian function, metabolic baselines, insulin responses, and dermatological consistency.',
    guide:
      '1. Monitor cycle spacing logs diligently.\n2. Note persistent hair texture variations or acne flare-ups.\n3. Implement balanced, low-glycemic active dietary support.\n4. Consult a clinical endocrinologist or OBGYN for systemic evaluations.',
    imageUrl:
      'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=600&auto=format&fit=crop',
    order: 1,
  },
  {
    title: 'Endometriosis',
    category: 'Uterine & Pelvic Wellness',
    icon: 'pulse',
    color: '#f97316',
    summary:
      'A condition where tissue similar to the uterine lining grows outside the uterus, often on pelvic organs. It can cause painful periods, pelvic pain and pain during sex. It can get worse over time for some people, but not always.',
    guide:
      '1. Log how bad your pain is, during and outside your period.\n2. Note heavy bleeding and when pain starts.\n3. A heat pad can ease pain when it flares.\n4. See a gynaecologist if pain stops you from doing everyday things.',
    imageUrl:
      'https://images.unsplash.com/photo-1551076805-e1869033e561?q=80&w=600&auto=format&fit=crop',
    order: 2,
  },
  {
    title: 'Fibroids',
    category: 'Structural Health',
    icon: 'apps-outline',
    color: '#fbbf24',
    summary:
      'Non-cancerous growths of muscle in or on the uterus. Some cause no symptoms; others cause heavy or long periods, pelvic pressure, and tiredness from blood loss.',
    guide:
      '1. Log very heavy, long or unexpected bleeding.\n2. Track pelvic pressure.\n3. Heavy bleeding can lower your iron, so ask a doctor about a blood test.\n4. A doctor can check for fibroids with an ultrasound.',
    imageUrl:
      'https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?q=80&w=600&auto=format&fit=crop',
    order: 3,
  },
  {
    title: 'Pregnancy Wellness',
    category: 'Maternal Milestone Care',
    icon: 'heart-outline',
    color: '#ec4899',
    summary:
      'Track early pregnancy symptoms like nausea and tiredness, and get simple tips for looking after yourself.',
    guide:
      '1. Note the date of your missed period.\n2. Track breast tenderness or other new symptoms.\n3. Drink enough water and take folic acid as your doctor advises.\n4. Go to your regular pregnancy check-ups.',
    imageUrl:
      'https://images.unsplash.com/photo-1516627145497-ae6968895b74?q=80&w=600&auto=format&fit=crop',
    order: 4,
  },
  {
    title: 'Irregular Cycles',
    category: 'Rhythm Diagnostics',
    icon: 'shuffle-outline',
    color: '#8b5cf6',
    summary:
      'Periods that come at unpredictable times. Common causes include pregnancy, stress, a big weight change or intense exercise, PCOS, thyroid problems, high prolactin, breastfeeding, perimenopause, and the first few years after periods start.',
    guide:
      '1. Log your period start dates for at least 3 months.\n2. If your period is late and you have had sex, take a pregnancy test.\n3. See a doctor if you have had no period for 3 months, your cycles are often shorter than 21 or longer than 35 days, or bleeding lasts more than 8 days.',
    imageUrl:
      'https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=600&auto=format&fit=crop',
    order: 5,
  },
  {
    title: 'Menopause Support',
    category: 'Transition & Longevity',
    icon: 'water-outline',
    color: '#06b6d4',
    summary:
      'The milestone endocrine evolution marking the completion of reproductive cycle intervals, accompanied by thermoregulation adjustments and sleep shifts.',
    guide:
      '1. Log how often you get hot flushes.\n2. Note night waking and sleep changes.\n3. Get enough calcium and vitamin D for your bones.\n4. Talk to a doctor about treatment, including HRT, if symptoms bother you.\n5. Any bleeding 12 months or more after your last period needs a prompt check with a doctor.',
    imageUrl:
      'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',
    order: 6,
  },
];

const wellbeingData = [
  {
    type: 'sexual_wellbeing',
    title: 'Intimacy & Periods',
    icon: 'heart-outline',
    color: '#d946a6',
    items: 8,
    summary:
      'Science-backed guidance on comfort parameters, physical safety maps, and clear boundary setup during active flows.',
    extendedGuide: [
      'Communication Hub: Discuss energy levels and flow intensity before establishing intimate touch.',
      'Natural Relief: Some people find an orgasm eases cramps.',
      'Stay Protected: You can still get pregnant or get an STI during your period, so use protection.',
      'Preparation: Place a dark comfort towel down to eliminate staining concerns.',
    ],
    order: 1,
  },
  {
    type: 'sexual_wellbeing',
    title: 'STI Prevention Guide',
    icon: 'shield-checkmark-outline',
    color: '#10b981',
    items: 12,
    summary:
      'Clear clinical barrier method breakdowns, routine health panel checkpoints, and stigma-free screening data.',
    extendedGuide: [
      'Condoms: Use a condom (or dental dam) every time, from start to finish.',
      'Routine Testing: Get tested at least once a year if you’re sexually active and under 25, and whenever you have a new partner or symptoms.',
      'No Symptoms: Many STIs have no signs at all, so testing is the only way to know.',
    ],
    order: 2,
  },
  {
    type: 'sexual_wellbeing',
    title: 'Contraception Matrix',
    icon: 'apps-outline',
    color: '#8b5cf6',
    items: 15,
    summary:
      'Compare hormonal adjustments, physical barriers, effectiveness indices, and what to discuss with an OBGYN.',
    extendedGuide: [
      'Double Protection: Using condoms with a hormonal method gives strong protection against pregnancy, and condoms also protect against STIs.',
      'Emergency Contraception: Use emergency contraception as soon as possible. Some pills work up to 3 days, others up to 5 days, and a copper IUD up to 5 days. A pharmacist or doctor can help.',
      'Talk to a Doctor: Check with a doctor before starting, stopping or switching a hormonal method.',
    ],
    order: 3,
  },
  {
    type: 'hygiene',
    title: 'Period Product Guide',
    icon: 'water-outline',
    color: '#0ea5e9',
    items: 10,
    summary:
      'Compare pads, tampons, menstrual cups, discs, and period underwear — pros, cons, and eco-impact.',
    extendedGuide: [
      'Menstrual Cups: Reusable and eco-friendly. Empty at least every 12 hours.',
      'Sensitive Skin: Unscented pads and tampons are gentler. Organic cotton is not proven to be safer.',
      'Period Underwear: Great backup option or light-flow primary solution.',
    ],
    order: 1,
  },
  {
    type: 'hygiene',
    title: 'Intimate Hygiene 101',
    icon: 'leaf-outline',
    color: '#22c55e',
    items: 7,
    summary:
      'Proper pH-balanced hygiene practices to avoid infections and maintain intimate health.',
    extendedGuide: [
      'The vagina is self-cleaning — avoid harsh soaps inside.',
      'Wear breathable cotton underwear to reduce moisture buildup.',
      'Pads: Change every 4–6 hours, or sooner if full.',
      'Tampons: Use the lowest absorbency you need. Change every 4–8 hours and never leave one in more than 8 hours.',
      'Menstrual Cups: Empty at least every 12 hours.',
      'TSS Warning: Sudden high fever, rash, vomiting or dizziness while using a tampon or cup? Remove it and get medical help right away.',
    ],
    order: 2,
  },
];

export const seedDatabase = async () => {
  try {
    // Seed Q&A
    const qaCount = await QuestionAnswer.countDocuments();
    if (qaCount === 0) {
      await QuestionAnswer.insertMany(qaData);
      logger.info('seeder_qa_seeded', { action: 'seeder_qa_seeded', count: qaData.length });
    }

    // Seed Doctors
    const doctorCount = await Doctor.countDocuments();
    if (doctorCount === 0) {
      await Doctor.insertMany(doctorData);
      logger.info('seeder_doctors_seeded', {
        action: 'seeder_doctors_seeded',
        count: doctorData.length,
      });
    }

    // Seed Health Issues
    const healthCount = await HealthIssue.countDocuments();
    if (healthCount === 0) {
      await HealthIssue.insertMany(healthIssueData);
      logger.info('seeder_health_issues_seeded', {
        action: 'seeder_health_issues_seeded',
        count: healthIssueData.length,
      });
    }

    // Seed Wellbeing Resources
    const wellbeingCount = await WellbeingResource.countDocuments();
    if (wellbeingCount === 0) {
      await WellbeingResource.insertMany(wellbeingData);
      logger.info('seeder_wellbeing_seeded', {
        action: 'seeder_wellbeing_seeded',
        count: wellbeingData.length,
      });
    }

    // Seed Blogs — upsert by slug (not a one-time count guard) so newly added
    // articles land on existing databases. Insert-only ($setOnInsert): this
    // used to `$set` the whole seed post on every boot, so each deploy or
    // restart re-published seed blogs an admin had unpublished/archived,
    // reset their publishedAt to "now" and reverted their edits — the admin's
    // status change looked like it hadn't stuck.
    const blogResults = await Promise.all(
      blogData.map((blog) =>
        Blog.updateOne({ slug: blog.slug }, { $setOnInsert: blog }, { upsert: true }),
      ),
    );
    const blogsUpserted = blogResults.filter((r) => r.upsertedCount > 0).length;
    logger.info('seeder_blogs_seeded', {
      action: 'seeder_blogs_seeded',
      total: blogData.length,
      inserted: blogsUpserted,
    });

    // Seed Reels
    const reelCount = await Reel.countDocuments();
    if (reelCount === 0) {
      await Reel.insertMany(reelData);
      logger.info('seeder_reels_seeded', { action: 'seeder_reels_seeded', count: reelData.length });
    }

    // Seed Government Benefits — upsert by slug so newly added schemes and
    // re-verified details land on existing databases (like blogs above).
    const benefitResults = await Promise.all(
      governmentBenefitData.map((benefit) =>
        GovernmentBenefit.updateOne({ slug: benefit.slug }, { $set: benefit }, { upsert: true }),
      ),
    );
    const benefitsUpserted = benefitResults.filter((r) => r.upsertedCount > 0).length;
    logger.info('seeder_government_benefits_seeded', {
      action: 'seeder_government_benefits_seeded',
      total: governmentBenefitData.length,
      inserted: benefitsUpserted,
    });

    // Seed the subscription feature catalog — by key, insert-only
    // ($setOnInsert). Unlike blogs/benefits above, an existing row is never
    // overwritten: an admin's isPremium/price/isActive edits from the
    // Content Studio must survive every server restart untouched. New keys
    // added to subscriptionFeatureData.js in future deploys still land.
    const featureResults = await Promise.all(
      subscriptionFeatureData.map((feature) =>
        SubscriptionFeature.updateOne(
          { key: feature.key },
          { $setOnInsert: feature },
          { upsert: true },
        ),
      ),
    );
    const featuresInserted = featureResults.filter((r) => r.upsertedCount > 0).length;
    logger.info('seeder_subscription_features_seeded', {
      action: 'seeder_subscription_features_seeded',
      total: subscriptionFeatureData.length,
      inserted: featuresInserted,
    });

    // Seed the subscription settings singleton — only when it doesn't exist
    // yet, so an admin's saved settings are never reset on restart.
    const settingsCount = await SubscriptionSettings.countDocuments();
    if (settingsCount === 0) {
      await SubscriptionSettings.create({});
      logger.info('seeder_subscription_settings_seeded', {
        action: 'seeder_subscription_settings_seeded',
      });
    }

    // One-time data repairs; both are no-ops once applied.
    // Blogs whose status/isPublished drifted apart before Blog.js kept them in
    // sync — isPublished is what the Admin Workspace set, so it wins. Raw
    // collection writes: the Blog update hooks would otherwise rewrite them.
    await Blog.collection.updateMany(
      { isPublished: true, status: { $ne: 'published' } },
      { $set: { status: 'published' } },
    );
    await Blog.collection.updateMany(
      { isPublished: { $ne: true }, status: 'published' },
      { $set: { status: 'draft' } },
    );
    // Reading time is computed from content now; fix posts saved with none,
    // a hand-typed estimate, or an older formula. Only changed posts are
    // written, without touching updatedAt.
    await Blog.backfillReadTimes();
    // Accounts deleted in-app before accountLifecycle existed: set deletedAt
    // and tear down what they left behind (visible posts, partner links…).
    await backfillLegacyDeletedAccounts();
    // INR is the only currency for now (wallet and payouts are INR): move any
    // doctor priced in another currency over, keeping the number, and say so
    // in the log so an admin can check those fees.
    const nonInr = await Doctor.find({ currency: { $ne: 'INR' } })
      .select('_id name currency pricePerSession')
      .lean();
    if (nonInr.length) {
      await Doctor.collection.updateMany(
        { currency: { $ne: 'INR' } },
        { $set: { currency: 'INR' } },
      );
      logger.warn('seeder_doctor_currency_set_inr', {
        action: 'seeder_doctor_currency_set_inr',
        doctors: nonInr.map((d) => ({
          id: String(d._id),
          name: d.name,
          was: d.currency,
          fee: d.pricePerSession,
        })),
      });
    }
    // Weekly hours saved before the portal sent a time zone were entered in
    // India time but stored as UTC.
    await DoctorAvailability.collection.updateMany(
      { $or: [{ timezone: 'UTC' }, { timezone: { $exists: false } }, { timezone: '' }] },
      { $set: { timezone: 'Asia/Kolkata' } },
    );

    logger.info('seeder_complete', { action: 'seeder_complete' });
  } catch (error) {
    logger.error('seeder_error', { action: 'seeder_error', error: error.message });
  }
};

// Backward compat — keep old export working
export const seedQA = seedDatabase;
