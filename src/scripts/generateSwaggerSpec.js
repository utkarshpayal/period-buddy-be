import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the snapshot of 234 routes
const routesSnapshot = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../config/allRoutesSnapshot.json'), 'utf8'),
);

// Helper to convert Express path to OpenAPI path (:id -> {id})
function toOpenApiPath(p) {
  return p.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

// Extract path parameter names from Express path
function extractPathParams(p) {
  const matches = p.match(/:([a-zA-Z0-9_]+)/g);
  if (!matches) return [];
  return matches.map((m) => m.substring(1));
}

// Tag metadata map with nice descriptions
const TAGS_METADATA = [
  {
    name: 'System & Health',
    description: 'API health checks, liveness probes, readiness probes, and webhooks',
  },
  {
    name: 'Authentication',
    description:
      'User registration, OTP verification, login, Google OAuth, onboarding, password management, profile, account deletion, and FCM notifications',
  },
  {
    name: 'Cycle Tracking',
    description:
      'Menstrual cycle logging, smart cycle predictions, cycle history, and symptom forecasting',
  },
  {
    name: 'Habits & Wellness',
    description:
      'Daily wellness habits, completion tracking, habit streak gamification, and token rewards',
  },
  {
    name: 'Wellness Forest',
    description:
      'Gamified digital forest reflecting overall menstrual & daily care consistency with tier progression',
  },
  {
    name: 'Consultations',
    description:
      'Patient-side gynecologist booking, Cashfree payments, real-time consultation messaging, and status management',
  },
  {
    name: 'Doctor Portal',
    description:
      'Clinical management portal: doctor onboarding, patient records, consultation messages, WebRTC video calling, prescriptions, earnings, availability slots, and clinical video reels',
  },
  {
    name: 'Partner Sync',
    description:
      'Cycle syncing for romantic partners: invite codes, granular privacy toggles, shared cycle status, partner alerts, and direct messaging',
  },
  {
    name: 'Anonymous Period Buddy',
    description:
      'Peer-to-peer anonymous cycle buddy matching based on phase compatibility and anonymous in-app chat',
  },
  {
    name: 'Email Nominations',
    description:
      'Refer friends & loved ones to Period Buddy with personalized invitations and acceptance tracking',
  },
  {
    name: 'Q&A Knowledge Base',
    description:
      'Curated clinical Q&A encyclopedia and interactive chat sessions with smart semantic retrieval',
  },
  {
    name: 'Sarvam Voice Agent',
    description:
      'Voice-based menstrual care companion powered by Sarvam AI: conversational cycle logging, check-in call scheduling, webhooks, and scheduler ticks',
  },
  {
    name: 'Community Feed',
    description:
      'Moderated peer community: anonymous posts, category filters, likes, bookmarks, comments, reporting, and poll voting',
  },
  {
    name: 'Blogs & Articles',
    description:
      'Doctor-verified women health editorial articles, reading feeds, multi-lingual translations, likes, bookmarks, and view tracking',
  },
  {
    name: 'Video Reels',
    description:
      'Short-form educational medical reels by verified doctors, poll voting, creator follow toggles, and view tracking',
  },
  {
    name: 'Health Encyclopedia',
    description:
      'Clinical guide to conditions like PCOS/PCOD, endometriosis, fibroids, hormonal imbalances, and treatment guides',
  },
  {
    name: 'Wellbeing & Intimacy',
    description:
      'Hygiene advice, intimacy guides, card games (Spark & Positions decks), and view tracking',
  },
  {
    name: 'Unified Content Studio',
    description:
      'Universal content management system (CMS) for blogs, reels, Q&A, health guides, and media uploads',
  },
  {
    name: 'Government Schemes',
    description:
      'Catalogue of Indian central and state welfare benefits, menstrual hygiene schemes, and eligibility evaluations',
  },
  {
    name: 'Scheme Applications',
    description:
      'Self-service and admin-managed application processing for government welfare schemes',
  },
  {
    name: 'Subscriptions & Paywall',
    description:
      'Pricing plans, modular feature unlocks, Cashfree payment gateway integration, coupon discounts, and entitlements',
  },
  {
    name: 'Admin Subscriptions',
    description:
      'Super Admin paywall controls: subscription plans, feature gating, dynamic pricing, and coupon codes',
  },
  {
    name: 'Super Admin',
    description:
      'Platform analytics, user directory, account status moderation, and platform-wide controls',
  },
  {
    name: 'Document Vault & OCR',
    description:
      'Medical document vault with OCR text extraction, clinical document summaries, and interactive document chat',
  },
  {
    name: 'Clinical Reports',
    description:
      'Comprehensive medical and cycle report generation with doctor consultation summaries',
  },
  {
    name: 'Speech Services',
    description:
      'Multilingual speech-to-text transcription and text-to-speech audio synthesis via Sarvam AI',
  },
  {
    name: 'Health Screening',
    description:
      'Clinical screening assessments (PCOS, cycle irregularities) with automated risk evaluation',
  },
  {
    name: 'Daily Insights',
    description:
      'Personalized daily biological insights, phase tips, nutrition suggestions, and wellness tips',
  },
  {
    name: 'Notifications',
    description: 'Push notification dispatcher, daily cron triggers, and scheduled reminders',
  },
  {
    name: 'Marketing & Newsletter',
    description: 'Public newsletter subscription, unsubscribe workflows, and subscriber management',
  },
  {
    name: 'Contact Inquiries',
    description: 'Public contact & feedback form submission and admin inquiry management',
  },
  {
    name: 'File Uploads',
    description:
      'Multi-purpose secure asset uploads to AWS S3 & Cloudinary with MIME type validation',
  },
  {
    name: 'Audit Trail',
    description: 'Administrative compliance audit logs tracking high-privilege operations',
  },
  {
    name: 'Company Assets',
    description:
      'Organizational document repository with folder organization and public share links',
  },
  {
    name: 'Company Folders',
    description: 'Directory hierarchy for company documents and internal assets',
  },
];

function determineTag(r) {
  const g = r.group;
  const p = r.path;

  if (g === 'Health' || p.startsWith('/health')) return 'System & Health';
  if (p === '/api/payments/return') return 'System & Health';
  if (g === 'Auth' || g === 'auth') return 'Authentication';
  if (g === 'cycle') return 'Cycle Tracking';
  if (g === 'habit') return 'Habits & Wellness';
  if (g === 'forest') return 'Wellness Forest';
  if (g === 'consultation') return 'Consultations';
  if (g === 'doctor') return 'Doctor Portal';
  if (g === 'partner') return 'Partner Sync';
  if (g === 'buddy') return 'Anonymous Period Buddy';
  if (g === 'nomination') return 'Email Nominations';
  if (g === 'questionAnswer') return 'Q&A Knowledge Base';
  if (g === 'voiceAgent') return 'Sarvam Voice Agent';
  if (g === 'community') return 'Community Feed';
  if (g === 'blog') return 'Blogs & Articles';
  if (g === 'reel') return 'Video Reels';
  if (g === 'healthIssue') return 'Health Encyclopedia';
  if (g === 'wellbeing') return 'Wellbeing & Intimacy';
  if (g === 'content') return 'Unified Content Studio';
  if (g === 'scheme') return 'Government Schemes';
  if (g === 'schemeApplication') return 'Scheme Applications';
  if (g === 'subscription') return 'Subscriptions & Paywall';
  if (g === 'adminSubscription') return 'Admin Subscriptions';
  if (g === 'admin') return 'Super Admin';
  if (g === 'document') return 'Document Vault & OCR';
  if (g === 'report') return 'Clinical Reports';
  if (g === 'speech') return 'Speech Services';
  if (g === 'screening') return 'Health Screening';
  if (g === 'insight') return 'Daily Insights';
  if (g === 'notification') return 'Notifications';
  if (g === 'newsletter') return 'Marketing & Newsletter';
  if (g === 'contact') return 'Contact Inquiries';
  if (g === 'upload') return 'File Uploads';
  if (g === 'audit') return 'Audit Trail';
  if (g === 'companyAsset') return 'Company Assets';
  if (g === 'companyFolder') return 'Company Folders';
  return 'System & Health';
}

function determineSecurity(r) {
  const p = r.path;
  const m = r.method;

  // Explicit public endpoints
  if (p.startsWith('/health') || p === '/api/payments/return') return [];
  if (p === '/api/auth/signup' || p === '/api/auth/verify-otp' || p === '/api/auth/resend-otp')
    return [];
  if (p === '/api/auth/login' || p === '/api/auth/google') return [];
  if (p.startsWith('/api/auth/account/delete')) return [];
  if (p === '/api/doctor/set-password') return [];
  if (p === '/api/subscriptions/plans' || p === '/api/subscriptions/features') return [];
  if (p === '/api/newsletter/subscribe' || p.startsWith('/api/newsletter/unsubscribe')) return [];
  if (p === '/api/contact' && m === 'POST') return [];
  if (p === '/api/company-assets/public') return [];

  // Public GET endpoints for content
  if (m === 'GET') {
    if (p === '/api/blogs' || p === '/api/blogs/feed' || p.match(/^\/api\/blogs\/[^/]+$/))
      return [];
    if (p === '/api/reels' || p.match(/^\/api\/reels\/[^/]+$/)) return [];
    if (p === '/api/questions' || p.match(/^\/api\/questions\/[^/]+$/)) {
      if (!p.includes('/sessions')) return [];
    }
    if (p === '/api/health-issues' || p.match(/^\/api\/health-issues\/[^/]+$/)) return [];
    if (
      p === '/api/wellbeing' ||
      p === '/api/wellbeing/games' ||
      p.match(/^\/api\/wellbeing\/[^/]+$/)
    )
      return [];
  }
  if (p === '/api/questions/ask' && m === 'POST') return [];

  // Default is protected
  return [{ bearerAuth: [] }];
}

function generateEndpointSpec(r) {
  const openPath = toOpenApiPath(r.path);
  const pathParams = extractPathParams(r.path);
  const tag = determineTag(r);
  const security = determineSecurity(r);
  const m = r.method.toLowerCase();

  const parameters = [];

  // Add path parameters
  for (const param of pathParams) {
    parameters.push({
      name: param,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: `Identifier or key: ${param}`,
    });
  }

  // Add common query parameters based on route patterns
  if (m === 'get') {
    if (
      r.path.includes('/admin/all') ||
      r.path.includes('/users') ||
      r.path.includes('/consultations') ||
      r.path.includes('/logs') ||
      r.path.includes('/history') ||
      [
        '/api/blogs',
        '/api/blogs/feed',
        '/api/community',
        '/api/questions',
        '/api/reels',
        '/api/schemes',
        '/api/content',
        '/api/documents',
      ].includes(r.path)
    ) {
      parameters.push(
        {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', default: 1 },
          description: 'Page number for pagination',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', default: 10 },
          description: 'Number of items per page',
        },
      );
    }

    if (
      r.path.includes('/search') ||
      [
        '/api/blogs',
        '/api/blogs/feed',
        '/api/community',
        '/api/questions',
        '/api/reels',
        '/api/schemes',
        '/api/content',
        '/api/buddies/matches',
        '/api/consultation/doctors',
      ].includes(r.path)
    ) {
      parameters.push({
        name: 'search',
        in: 'query',
        schema: { type: 'string' },
        description: 'Search keyword',
      });
    }

    if (r.path === '/api/cycle/logs' || r.path === '/api/forest/logs') {
      parameters.push({
        name: 'month',
        in: 'query',
        schema: { type: 'string', example: '2026-07' },
        description: 'Year and month filter in YYYY-MM format',
      });
    }

    if (r.path === '/api/community') {
      parameters.push({
        name: 'category',
        in: 'query',
        schema: { type: 'string' },
        description: 'Community category (e.g. general, success_story, tips)',
      });
    }

    if (r.path === '/api/wellbeing') {
      parameters.push({
        name: 'type',
        in: 'query',
        schema: { type: 'string', enum: ['hygiene', 'sexual_wellbeing'] },
        description: 'Filter wellbeing resources by type',
      });
    }

    if (r.path === '/api/wellbeing/games') {
      parameters.push({
        name: 'deck',
        in: 'query',
        schema: { type: 'string', enum: ['spark', 'positions'] },
        description: 'Card game deck name',
      });
    }
  }

  // Build summary & description
  const cleanAction = r.path
    .replace('/api/', '')
    .replace(/\//g, ' ')
    .replace(/:/g, '')
    .replace(/-/g, ' ');

  const summary = `${r.method} ${r.path}`;
  const description = `${r.method.toUpperCase()} request to ${r.path}. Belongs to ${tag}.`;

  const responses = {
    200: {
      description: 'Successful operation',
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/StandardSuccessResponse',
          },
        },
      },
    },
  };

  if (r.method === 'POST') {
    responses['201'] = {
      description: 'Resource created successfully',
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/StandardSuccessResponse',
          },
        },
      },
    };
  }

  if (security.length > 0) {
    responses['401'] = {
      description: 'Unauthorized - Missing or invalid JWT Bearer token',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/StandardErrorResponse' },
        },
      },
    };
    responses['403'] = {
      description: 'Forbidden - Insufficient permissions / role restriction',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/StandardErrorResponse' },
        },
      },
    };
  }

  if (['POST', 'PUT', 'PATCH'].includes(r.method)) {
    responses['400'] = {
      description: 'Validation failed or malformed request payload',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ValidationErrorResponse' },
        },
      },
    };
  }

  const operation = {
    tags: [tag],
    summary,
    description,
    operationId: `${r.method.toLowerCase()}_${r.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
    parameters: parameters.length > 0 ? parameters : undefined,
    responses,
  };

  if (security.length > 0) {
    operation.security = security;
  }

  // Request Body for state mutations
  if (['POST', 'PUT', 'PATCH'].includes(r.method)) {
    // Check if it's a file upload route
    if (
      r.path.includes('/upload') ||
      r.path === '/api/speech/transcribe' ||
      r.path === '/api/company-assets' ||
      r.path === '/api/documents'
    ) {
      operation.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'File to upload',
                },
                folder: {
                  type: 'string',
                  description: 'Destination category/folder (optional)',
                },
                title: {
                  type: 'string',
                  description: 'Asset title (optional)',
                },
              },
            },
          },
        },
      };
    } else {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              example: getSamplePayload(r.path, r.method),
            },
          },
        },
      };
    }
  }

  return { openPath, method: m, operation };
}

function getSamplePayload(p, method) {
  if (p === '/api/auth/signup') {
    return {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'SecurePass123!',
      confirmPassword: 'SecurePass123!',
      phone: '+919876543210',
      dateOfBirth: '1998-02-14',
      gender: 'female',
    };
  }
  if (p === '/api/auth/verify-otp') {
    return { email: 'jane@example.com', otp: '123456' };
  }
  if (p === '/api/auth/resend-otp') {
    return { email: 'jane@example.com' };
  }
  if (p === '/api/auth/login') {
    return { email: 'jane@example.com', password: 'SecurePass123!' };
  }
  if (p === '/api/auth/google') {
    return { idToken: 'google_id_token_jwt_here' };
  }
  if (p === '/api/auth/onboarding') {
    return {
      dateOfBirth: '1998-02-14',
      gender: 'female',
      phone: '+919876543210',
      profilePicture: 'https://cdn.example.com/avatar.png',
    };
  }
  if (p === '/api/auth/profile') {
    return {
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+919876543210',
      dateOfBirth: '1998-02-14',
      gender: 'female',
    };
  }
  if (p === '/api/auth/change-password') {
    return { currentPassword: 'SecurePass123!', newPassword: 'NewSecurePass456!' };
  }
  if (p === '/api/auth/account/delete/request') {
    return { email: 'jane@example.com' };
  }
  if (p === '/api/auth/account/delete/confirm') {
    return { email: 'jane@example.com', code: '123456' };
  }
  if (p === '/api/auth/fcm-token') {
    return { fcmToken: 'firebase_cloud_messaging_device_token' };
  }
  if (p === '/api/cycle/settings') {
    return {
      lastPeriodStartDate: '2026-07-01',
      cycleLength: 28,
      periodLength: 5,
      remindersEnabled: true,
      reminderDaysBefore: 2,
    };
  }
  if (p === '/api/cycle/log') {
    return {
      dateKey: '2026-07-15',
      flow: 'medium',
      mood: 'calm',
      energy: 'steady',
      symptoms: ['cramps', 'bloating'],
      note: 'Mild cramps in the evening',
      isIntimate: false,
      sleepHours: 8,
      waterIntake: 2000,
    };
  }
  if (p === '/api/habits') {
    return {
      title: 'Drink 8 Glasses of Water',
      icon: 'water-outline',
      color: '#06b6d4',
      tokens: 30,
    };
  }
  if (p === '/api/forest/care') {
    return { dateKey: '2026-07-15', careType: 'water', note: 'Staying hydrated and balanced' };
  }
  if (p === '/api/consultation/order') {
    return { doctorId: '60d0fe4f5311236168a109ca', slotTime: '2026-07-20T10:00:00.000Z' };
  }
  if (p === '/api/consultation/verify') {
    return { orderId: 'CF_ORDER_123456' };
  }
  if (p.includes('/consultation') && p.includes('/message')) {
    return { text: 'Hello Doctor, I have question regarding cycle irregularity.' };
  }
  if (p === '/api/partner/invite') {
    return {};
  }
  if (p === '/api/partner/connect') {
    return { inviteCode: 'NURA-ABC123' };
  }
  if (p === '/api/partner/permissions') {
    return {
      shareCyclePhase: true,
      shareSymptoms: true,
      shareIntimacyLog: false,
      shareAlerts: true,
    };
  }
  if (p === '/api/partner/message') {
    return { text: 'How are you feeling today?' };
  }
  if (p === '/api/buddies/message') {
    return { text: 'Are you experiencing fatigue today as well?' };
  }
  if (p === '/api/nominations') {
    return {
      nomineeEmail: 'friend@example.com',
      nomineeName: 'Priya',
      message: 'Join me on Nura Care!',
    };
  }
  if (p.includes('/nominations') && p.includes('/respond')) {
    return { status: 'accepted' };
  }
  if (p === '/api/questions/ask') {
    return { question: 'Is brown period blood normal at the beginning of a cycle?' };
  }
  if (p.includes('/questions/sessions') && p.includes('/messages')) {
    return { content: 'Can stress delay my period?' };
  }
  if (p === '/api/voice-agent/converse') {
    return {
      transcript: 'I want to log my period today',
      language: 'en-IN',
      pendingAction: null,
      confirmed: false,
    };
  }
  if (p === '/api/voice-agent/checkin-call') {
    return { phoneNumber: '+919876543210', preferredTime: '18:00' };
  }
  if (p === '/api/community') {
    return {
      title: 'First month tracking with Nura',
      content: 'It helped me predict my cramps in advance!',
      category: 'success_story',
      tags: ['tracking'],
      isAnonymous: true,
    };
  }
  if (p.includes('/community') && p.includes('/comment')) {
    return { content: 'Thank you for sharing your experience!', isAnonymous: false };
  }
  if (p.includes('/community') && p.includes('/report')) {
    return { reason: 'Misleading medical information' };
  }
  if (p === '/api/subscriptions/coupons/apply') {
    return { couponCode: 'NURA50', planId: 'plan_annual_premium' };
  }
  if (p === '/api/subscriptions/order') {
    return { planId: 'plan_annual_premium', couponCode: 'WELCOME10' };
  }
  if (p === '/api/subscriptions/verify') {
    return { orderId: 'CF_SUB_987654' };
  }
  if (p === '/api/doctor/set-password') {
    return { inviteToken: 'tok_abc123', password: 'DoctorSecurePass123!' };
  }
  if (p === '/api/doctor/invite') {
    return {
      email: 'doctor@example.com',
      firstName: 'Dr. Anita',
      lastName: 'Sharma',
      specialty: 'Gynecologist',
      licenseNumber: 'MCI-12345',
    };
  }
  if (p === '/api/contact') {
    return {
      name: 'Sunita Rao',
      email: 'sunita@example.com',
      subject: 'Product Inquiry',
      message: 'I love this app, wanted to ask about family plans.',
    };
  }
  if (p === '/api/newsletter/subscribe') {
    return { email: 'subscriber@example.com' };
  }
  if (p === '/api/screening/assess') {
    return {
      assessmentType: 'pcos_risk',
      answers: [
        { questionId: 'q1', answer: 'irregular' },
        { questionId: 'q2', answer: 'yes' },
      ],
    };
  }
  if (p === '/api/speech/synthesize') {
    return { text: 'Your next cycle is predicted in 5 days.', language: 'en-IN' };
  }
  return { notes: 'Request payload' };
}

async function build() {
  const pathsObj = {};

  for (const r of routesSnapshot) {
    const { openPath, method, operation } = generateEndpointSpec(r);

    if (!pathsObj[openPath]) {
      pathsObj[openPath] = {};
    }
    pathsObj[openPath][method] = operation;
  }

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Period Buddy / NURA CARE API',
      version: '2.0.0',
      description: `
## Comprehensive REST API Documentation for Period Buddy & NURA CARE Backend

Welcome to the official interactive OpenAPI 3.0 documentation for the **Period Buddy (NURA CARE)** backend service.
This backend powers the mobile applications (iOS/Android), the Content Studio web administration portal, the Clinician & Doctor care portal, and partner integrations.

### Key Highlights & Architecture
- **234 Production Endpoints** spanning 35 core functional modules
- **Role-Based Access Control**: Public, Authenticated User (\`user\`), Clinician (\`doctor\`), and Super Admin (\`admin\`)
- **Authentication**: JWT Bearer Tokens with strict bcrypt hashing, rate limiting, and OTP verification
- **Real-Time Features**: WebSockets for consultation messaging and partner synchronizations
- **AI Integrations**: Sarvam AI Voice Agent (multilingual voice conversational cycle logging), Gemini AI health insights, and OCR document processing
- **Payments**: Cashfree Payment Gateway order generation, verification, and coupon engine

### Authentication Guide
To execute protected endpoints in this Swagger UI:
1. Call \`POST /api/auth/login\` or \`POST /api/auth/signup\` + \`POST /api/auth/verify-otp\`.
2. Copy the \`token\` string from the response.
3. Click the **Authorize 🔓** button at the top right, and paste your JWT token into the **BearerAuth** dialog.
      `,
      contact: {
        name: 'Nura Care Engineering Team',
        email: 'support@thenura.com',
        url: 'https://thenura.com',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Local Development Server',
      },
      {
        url: '/',
        description: 'Current Environment Relative Server',
      },
    ],
    tags: TAGS_METADATA,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Provide your JWT bearer token (e.g., Bearer eyJhbGciOi...) to authorize requests.',
        },
      },
      schemas: {
        StandardSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            statusCode: { type: 'integer', example: 200 },
            message: { type: 'string', example: 'Operation completed successfully' },
            data: { type: 'object', description: 'Payload response data or null' },
          },
          required: ['success', 'statusCode'],
        },
        StandardErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            statusCode: { type: 'integer', example: 401 },
            message: { type: 'string', example: 'Unauthorized access or invalid token' },
          },
          required: ['success', 'statusCode', 'message'],
        },
        ValidationErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            statusCode: { type: 'integer', example: 400 },
            message: { type: 'string', example: 'Validation failed' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', example: 'email' },
                  message: { type: 'string', example: 'Please provide a valid email address' },
                },
              },
            },
          },
          required: ['success', 'statusCode', 'message', 'errors'],
        },
      },
    },
    paths: pathsObj,
  };

  const outPath = path.resolve(__dirname, '../docs/openApiSpec.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));

  let totalOperations = 0;
  for (const p of Object.values(pathsObj)) {
    totalOperations += Object.keys(p).length;
  }

  console.log(`OpenAPI specification written successfully!`);
  console.log(`Total unique paths: ${Object.keys(pathsObj).length}`);
  console.log(`Total endpoints (operations) documented: ${totalOperations}`);
}

build();
