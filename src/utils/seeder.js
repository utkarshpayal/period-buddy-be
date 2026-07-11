import QuestionAnswer from '../models/QuestionAnswer.js';
import Doctor from '../models/Doctor.js';
import HealthIssue from '../models/HealthIssue.js';
import WellbeingResource from '../models/WellbeingResource.js';
import Blog from '../models/Blog.js';
import Reel from '../models/Reel.js';
import logger from './logger.js';

const qaData = [
  {
    question: 'What is a normal menstrual cycle length?',
    answer: 'A normal menstrual cycle ranges from 21 to 35 days, with the average being 28 days. Variation from month to month is also normal.',
    category: 'general',
    tags: ['cycle', 'menstruation', 'basics'],
  },
  {
    question: 'What are common PMS symptoms?',
    answer: 'Common PMS symptoms include bloating, breast tenderness, mood swings, irritability, fatigue, headaches, and food cravings. These typically occur 1–2 weeks before your period.',
    category: 'symptoms',
    tags: ['PMS', 'symptoms'],
  },
  {
    question: 'When is my fertile window?',
    answer: 'Your fertile window is typically 5 days before ovulation and the day of ovulation itself. Ovulation usually occurs around day 14 of a 28-day cycle, but varies.',
    category: 'fertility',
    tags: ['fertility', 'ovulation'],
  },
  {
    question: 'What is PCOS?',
    answer: 'Polycystic Ovary Syndrome (PCOS) is a hormonal disorder that causes enlarged ovaries with small cysts. It can cause irregular periods, excess androgen levels, and difficulty conceiving.',
    category: 'health',
    tags: ['PCOS', 'hormones'],
  },
  {
    question: 'How can I track my ovulation?',
    answer: 'You can track ovulation using: 1) Basal Body Temperature (BBT), 2) Ovulation prediction kits, 3) Cervical mucus monitoring, 4) Calendar tracking apps like Period Buddy.',
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
    category: 'Cycle Health',
    tags: ['cycle', 'hormones', 'tracking'],
    excerpt: 'A practical guide to menstrual cycle phases, mood and energy shifts, and how tracking helps you notice your own pattern.',
    content: 'Your menstrual cycle is shaped by hormone changes across period, follicular, ovulation, and luteal phases. Tracking flow, mood, energy, and symptoms can help you understand your personal rhythm and prepare for recurring changes.',
    coverImageUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 8,
    isPublished: true,
    publishedAt: new Date(),
  },
  {
    title: 'PCOS and PCOD: What to Track',
    slug: 'pcos-and-pcod-what-to-track',
    author: 'Dr. Priya Sharma',
    category: 'Health Concerns',
    tags: ['pcos', 'pcod', 'hormones'],
    excerpt: 'Common signs of PCOS/PCOD, what to log, and when to bring symptoms to a clinician for evaluation.',
    content: 'PCOS and PCOD can affect period timing, acne, hair growth, weight changes, and energy. Track cycle gaps, skin changes, hair growth, pain, and fatigue. A clinician can help evaluate hormones, metabolic health, and treatment options.',
    coverImageUrl: 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=600&auto=format&fit=crop',
    readTimeMinutes: 12,
    isPublished: true,
    publishedAt: new Date(),
  },
];

const reelData = [
  {
    title: 'A Simple Overview of Hormonal Cycle Phases',
    creatorId: 'doc_sarah',
    creatorName: 'Dr. Sarah Chen (OBGYN & Cycle Expert)',
    creatorAvatar: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?q=80&w=150&auto=format&fit=crop',
    duration: '0:15',
    category: 'Wellness',
    verified: true,
    thumbnailUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',
    directMp4Url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
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
    creatorAvatar: 'https://images.unsplash.com/photo-1594824813573-246434e33963?q=80&w=150&auto=format&fit=crop',
    duration: '0:12',
    category: 'Self-Care',
    verified: true,
    thumbnailUrl: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=600&auto=format&fit=crop',
    directMp4Url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
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
    summary: 'Polycystic Ovary Syndrome is a complex metabolic and endocrine disorder that can disrupt ovarian function, metabolic baselines, insulin responses, and dermatological consistency.',
    guide: '1. Monitor cycle spacing logs diligently.\n2. Note persistent hair texture variations or acne flare-ups.\n3. Implement balanced, low-glycemic active dietary support.\n4. Consult a clinical endocrinologist or OBGYN for systemic evaluations.',
    imageUrl: 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=600&auto=format&fit=crop',
    order: 1,
  },
  {
    title: 'Endometriosis',
    category: 'Uterine & Pelvic Wellness',
    icon: 'pulse',
    color: '#f97316',
    summary: 'A progressive condition where tissue similar to the uterine lining extends onto pelvic organs, often generating extreme inflammatory cycles.',
    guide: '1. Quantify pain indexes specifically during and outside menstruation.\n2. Record heavy bleeding logs and pain anchors.\n3. Integrate warm thermal compresses during muscle fatigue stages.\n4. Access advanced imaging pathways via certified gynaecology centers.',
    imageUrl: 'https://images.unsplash.com/photo-1551076805-e1869033e561?q=80&w=600&auto=format&fit=crop',
    order: 2,
  },
  {
    title: 'Fibroids',
    category: 'Structural Health',
    icon: 'apps-outline',
    color: '#fbbf24',
    summary: 'Benign muscular tissue developments within the uterine layers that can expand, introducing local pressure, heavy discharge parameters, and frequent fatigue.',
    guide: '1. Log abnormal volume fluctuations or sudden unexpected flows.\n2. Track pelvic pressure indicators.\n3. Balance iron mineral tracking if high bleeding occurs.\n4. Confirm alignment using ultrasound diagnostics.',
    imageUrl: 'https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?q=80&w=600&auto=format&fit=crop',
    order: 3,
  },
  {
    title: 'Pregnancy Wellness',
    category: 'Maternal Milestone Care',
    icon: 'heart-outline',
    color: '#ec4899',
    summary: 'Dedicated structural insight suite tracking preliminary symptoms, embryonic biological intervals, nausea variations, and targeted lifestyle optimization.',
    guide: '1. Record accurate missed timeline milestones.\n2. Trace breast sensitivity or sudden sensory fluctuations.\n3. Prioritize clean organic hydration and recommended folate blocks.\n4. Validate baseline growth structures regularly.',
    imageUrl: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?q=80&w=600&auto=format&fit=crop',
    order: 4,
  },
  {
    title: 'Irregular Cycles',
    category: 'Rhythm Diagnostics',
    icon: 'shuffle-outline',
    color: '#8b5cf6',
    summary: 'Persistent deviations from common cycle frequencies, frequently activated by cortisol stress triggers, underlying endocrine transitions, or sudden travel modifications.',
    guide: '1. Track structural start windows across consecutive 90-day segments.\n2. Correlate periods against sleep metrics and mental workloads.\n3. Reduce systemic inflammatory patterns using mindfulness modules.',
    imageUrl: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=600&auto=format&fit=crop',
    order: 5,
  },
  {
    title: 'Menopause Support',
    category: 'Transition & Longevity',
    icon: 'water-outline',
    color: '#06b6d4',
    summary: 'The milestone endocrine evolution marking the completion of reproductive cycle intervals, accompanied by thermoregulation adjustments and sleep shifts.',
    guide: '1. Log the spacing frequency of sudden hot flash intervals.\n2. Evaluate midnight wakefulness indices.\n3. Reinforce calcium and trace minerals configuration.\n4. Engage hormone replacement discussion if discomfort increases.',
    imageUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',
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
    summary: 'Science-backed guidance on comfort parameters, physical safety maps, and clear boundary setup during active flows.',
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
    summary: 'Clear clinical barrier method breakdowns, routine health panel checkpoints, and stigma-free screening data.',
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
    summary: 'Compare hormonal adjustments, physical barriers, effectiveness indices, and what to discuss with an OBGYN.',
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
    summary: 'Compare pads, tampons, menstrual cups, discs, and period underwear — pros, cons, and eco-impact.',
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
    summary: 'Proper pH-balanced hygiene practices to avoid infections and maintain intimate health.',
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
      logger.info('seeder_doctors_seeded', { action: 'seeder_doctors_seeded', count: doctorData.length });
    }

    // Seed Health Issues
    const healthCount = await HealthIssue.countDocuments();
    if (healthCount === 0) {
      await HealthIssue.insertMany(healthIssueData);
      logger.info('seeder_health_issues_seeded', { action: 'seeder_health_issues_seeded', count: healthIssueData.length });
    }

    // Seed Wellbeing Resources
    const wellbeingCount = await WellbeingResource.countDocuments();
    if (wellbeingCount === 0) {
      await WellbeingResource.insertMany(wellbeingData);
      logger.info('seeder_wellbeing_seeded', { action: 'seeder_wellbeing_seeded', count: wellbeingData.length });
    }

    // Seed Blogs
    const blogCount = await Blog.countDocuments();
    if (blogCount === 0) {
      await Blog.insertMany(blogData);
      logger.info('seeder_blogs_seeded', { action: 'seeder_blogs_seeded', count: blogData.length });
    }

    // Seed Reels
    const reelCount = await Reel.countDocuments();
    if (reelCount === 0) {
      await Reel.insertMany(reelData);
      logger.info('seeder_reels_seeded', { action: 'seeder_reels_seeded', count: reelData.length });
    }

    logger.info('seeder_complete', { action: 'seeder_complete' });
  } catch (error) {
    logger.error('seeder_error', { action: 'seeder_error', error: error.message });
  }
};

// Backward compat — keep old export working
export const seedQA = seedDatabase;
