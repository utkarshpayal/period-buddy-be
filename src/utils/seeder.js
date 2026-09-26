import QuestionAnswer from '../models/QuestionAnswer.js';
import Doctor from '../models/Doctor.js';
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
      'Polycystic Ovary Syndrome (PCOS) is a hormonal disorder that causes enlarged ovaries with small cysts. It can cause irregular periods, excess androgen levels, and difficulty conceiving.',
    category: 'health',
    tags: ['PCOS', 'hormones'],
  },
  {
    question: 'How can I track my ovulation?',
    slug: 'how-can-i-track-my-ovulation',
    answer:
      'You can track ovulation using: 1) Basal Body Temperature (BBT), 2) Ovulation prediction kits, 3) Cervical mucus monitoring, 4) Calendar tracking apps like Period Buddy.',
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
      '1. Menstrual phase (roughly days 1–5). Hormone levels are at their lowest and the uterine lining sheds. Energy often dips, and rest is genuinely useful here rather than a sign of weakness.',
      '',
      '2. Follicular phase (roughly days 6–13). Oestrogen climbs as follicles mature. Many people notice rising energy, clearer skin and a brighter mood — a good window for harder workouts and demanding tasks.',
      '',
      '3. Ovulation (around day 14 in a 28-day cycle). LH surges and an egg is released. Libido and confidence often peak, and cervical mucus becomes clear and stretchy.',
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
      'In the follicular and ovulation phases, energy is usually higher. Protein and fresh produce support that natural momentum, and it is often the easiest time to cook and plan ahead.',
      '',
      'In the luteal phase, cravings for carbohydrates and sweet foods are common as progesterone rises and serotonin dips. Complex carbohydrates (oats, whole grains, fruit) and magnesium-rich foods (dark chocolate, nuts, seeds) can steady mood and energy better than highly processed sugar. The goal is not perfection — it is fewer big crashes.',
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
      'A progressive condition where tissue similar to the uterine lining extends onto pelvic organs, often generating extreme inflammatory cycles.',
    guide:
      '1. Quantify pain indexes specifically during and outside menstruation.\n2. Record heavy bleeding logs and pain anchors.\n3. Integrate warm thermal compresses during muscle fatigue stages.\n4. Access advanced imaging pathways via certified gynaecology centers.',
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
      'Benign muscular tissue developments within the uterine layers that can expand, introducing local pressure, heavy discharge parameters, and frequent fatigue.',
    guide:
      '1. Log abnormal volume fluctuations or sudden unexpected flows.\n2. Track pelvic pressure indicators.\n3. Balance iron mineral tracking if high bleeding occurs.\n4. Confirm alignment using ultrasound diagnostics.',
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
      'Dedicated structural insight suite tracking preliminary symptoms, embryonic biological intervals, nausea variations, and targeted lifestyle optimization.',
    guide:
      '1. Record accurate missed timeline milestones.\n2. Trace breast sensitivity or sudden sensory fluctuations.\n3. Prioritize clean organic hydration and recommended folate blocks.\n4. Validate baseline growth structures regularly.',
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
      'Persistent deviations from common cycle frequencies, frequently activated by cortisol stress triggers, underlying endocrine transitions, or sudden travel modifications.',
    guide:
      '1. Track structural start windows across consecutive 90-day segments.\n2. Correlate periods against sleep metrics and mental workloads.\n3. Reduce systemic inflammatory patterns using mindfulness modules.',
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
      '1. Log the spacing frequency of sudden hot flash intervals.\n2. Evaluate midnight wakefulness indices.\n3. Reinforce calcium and trace minerals configuration.\n4. Engage hormone replacement discussion if discomfort increases.',
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
      'Natural Relief: Endorphins released during climax can act as an organic painkiller for heavy tracking cramps.',
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
      'Barrier Mechanics: Always ensure compatible protective barriers are deployed from the start.',
      'Routine Testing: Clinical panels are recommended every 6 months for active partners.',
      'Asymptomatic Spreads: Many micro-bacterial pathways transfer without physical signs.',
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
      'Double Shielding: Combine barrier tracking with hormonal tracking loops for up to 99% accuracy.',
      'Emergency Window: Pill methods are most active when deployed within 72 hours.',
      'OBGYN Alignment: Consult our clinical desk before modifying regular hormonal cycles.',
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
      'Menstrual Cups: Reusable, holds up to 12 hours, environmentally friendly.',
      'Organic Cotton: Better for sensitive skin — fewer chemicals and bleaching agents.',
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
      'Change period products every 4–8 hours to prevent bacterial growth.',
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
    // articles land on existing databases, and so the earlier seed blogs that
    // were saved without status:'published' (and were therefore invisible in
    // the feed) get corrected on the next boot.
    const blogResults = await Promise.all(
      blogData.map((blog) => Blog.updateOne({ slug: blog.slug }, { $set: blog }, { upsert: true })),
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
    // Accounts deleted in-app before accountLifecycle existed: set deletedAt
    // and tear down what they left behind (visible posts, partner links…).
    await backfillLegacyDeletedAccounts();

    logger.info('seeder_complete', { action: 'seeder_complete' });
  } catch (error) {
    logger.error('seeder_error', { action: 'seeder_error', error: error.message });
  }
};

// Backward compat — keep old export working
export const seedQA = seedDatabase;
