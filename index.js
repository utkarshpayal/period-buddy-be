import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import { apiLimiter, rateLimitEnabled } from './src/middleware/rateLimiters.js';
import { connectDB, disconnectDB } from './src/config/database.js';
import { seedDatabase } from './src/utils/seeder.js';
import { errorHandler, notFound } from './src/middleware/errorHandler.js';
import httpLogger from './src/utils/httpLogger.js';
import logger from './src/utils/logger.js';
import { authenticate } from './src/middleware/authMiddleware.js';
import { logout as logoutController } from './src/controllers/authController.js';
import { createServer } from 'http';
import { initWebSocket } from './src/config/websocket.js';

// Route imports
import authRoutes from './src/routes/authRoutes.js';
import questionAnswerRoutes from './src/routes/questionAnswerRoutes.js';
import cycleRoutes from './src/routes/cycleRoutes.js';
import habitRoutes from './src/routes/habitRoutes.js';
import consultationRoutes from './src/routes/consultationRoutes.js';
import partnerRoutes from './src/routes/partnerRoutes.js';
import healthIssueRoutes from './src/routes/healthIssueRoutes.js';
import blogRoutes from './src/routes/blogRoutes.js';
import contentRoutes from './src/routes/contentRoutes.js';
import communityRoutes from './src/routes/communityRoutes.js';
import nominationRoutes from './src/routes/nominationRoutes.js';
import wellbeingRoutes from './src/routes/wellbeingRoutes.js';
import reelRoutes from './src/routes/reelRoutes.js';
import forestRoutes from './src/routes/forestRoutes.js';
import buddyRoutes from './src/routes/buddyRoutes.js';
import newsletterRoutes from './src/routes/newsletterRoutes.js';
import contactRoutes from './src/routes/contactRoutes.js';
import uploadRoutes from './src/routes/uploadRoutes.js';
import documentRoutes from './src/routes/documentRoutes.js';
import reportRoutes from './src/routes/reportRoutes.js';
import speechRoutes from './src/routes/speechRoutes.js';
import screeningRoutes from './src/routes/screeningRoutes.js';
import insightRoutes from './src/routes/insightRoutes.js';
import voiceAgentRoutes from './src/routes/voiceAgentRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import doctorRoutes from './src/routes/doctorRoutes.js';
import schemeRoutes from './src/routes/schemeRoutes.js';
import schemeApplicationRoutes from './src/routes/schemeApplicationRoutes.js';
import auditRoutes from './src/routes/auditRoutes.js';
import companyAssetRoutes from './src/routes/companyAssetRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';

const app = express();

// Behind a reverse proxy (nginx / load balancer) in production, so req.ip and
// rate-limit keys reflect the real client IP from X-Forwarded-For.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

/* ──────────────────────────────────────────────────────────
   Database
────────────────────────────────────────────────────────── */
connectDB().then(() => {
  seedDatabase();
});

/* ──────────────────────────────────────────────────────────
   Security & Core Middleware
────────────────────────────────────────────────────────── */
app.use(helmet());

// CORS: in production, restrict to an explicit allowlist (ALLOWED_ORIGINS,
// comma-separated). Elsewhere (dev), reflect the request origin so Expo dev
// clients / localhost tooling work without configuration.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowAllOrigins = allowedOrigins.includes('*');

const corsOptions = {
  origin(origin, callback) {
    // Non-browser clients (mobile app, curl, server-to-server) send no Origin.
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    // ALLOWED_ORIGINS=* opts into reflecting any origin (note: with
    // credentials:true, browsers require the actual origin echoed back,
    // not a literal "*" header — the `cors` package handles that).
    if (allowAllOrigins) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate limiting — enabled in production by default (see rateLimiters.js).
// Sensitive auth endpoints get a stricter limiter inside authRoutes.js.
if (rateLimitEnabled) {
  app.use('/api', apiLimiter);
  logger.info('rate_limiting_enabled', { action: 'rate_limiting_enabled' });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// HTTP request logging (Morgan → Winston)
app.use(httpLogger);

/* ──────────────────────────────────────────────────────────
   Health Check
────────────────────────────────────────────────────────── */
// Liveness — the process is up. Never touches dependencies.
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Period Buddy API is running',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Readiness — the app can actually serve traffic (DB connected). Returns 503
// when the database isn't ready so orchestrators/load balancers can hold
// traffic. Exposes only a coarse status string, never connection details.
app.get('/health/ready', (req, res) => {
  // mongoose.connection.readyState: 1 = connected.
  const dbConnected = mongoose.connection?.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    success: dbConnected,
    status: dbConnected ? 'ready' : 'not_ready',
    checks: { database: dbConnected ? 'up' : 'down' },
    timestamp: new Date().toISOString(),
  });
});

/* ──────────────────────────────────────────────────────────
   API Routes
────────────────────────────────────────────────────────── */
app.use('/api/auth', authRoutes);
app.post('/api/logout', authenticate, logoutController);
app.use('/api/questions', questionAnswerRoutes);
app.use('/api/cycle', cycleRoutes);
app.use('/api/habits', habitRoutes);
app.use('/api/consultation', consultationRoutes);
app.use('/api/partner', partnerRoutes);
app.use('/api/health-issues', healthIssueRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/nominations', nominationRoutes);
app.use('/api/wellbeing', wellbeingRoutes);
app.use('/api/reels', reelRoutes);
app.use('/api/forest', forestRoutes);
app.use('/api/buddies', buddyRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/speech', speechRoutes);
app.use('/api/screening', screeningRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/voice-agent', voiceAgentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/schemes', schemeRoutes);
app.use('/api/scheme-applications', schemeApplicationRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/company-assets', companyAssetRoutes);
app.use('/api/admin', adminRoutes);

/* ──────────────────────────────────────────────────────────
   Error Handling
────────────────────────────────────────────────────────── */
app.use(notFound);
app.use(errorHandler);

/* ──────────────────────────────────────────────────────────
   Start Server
────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 5000;
const server = createServer(app);
const wss = initWebSocket(server);

server.listen(PORT, () => {
  logger.info('server_started', {
    action: 'server_started',
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
  });
});

/* ──────────────────────────────────────────────────────────
   Process Error Handlers
────────────────────────────────────────────────────────── */
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('unhandled_rejection', { action: 'unhandled_rejection', reason: String(reason) });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', {
    action: 'uncaught_exception',
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

let shuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('graceful_shutdown_started', { action: 'graceful_shutdown_started', signal });

  // Force-exit if a hung connection prevents clean shutdown.
  const forceTimer = setTimeout(() => {
    logger.error('graceful_shutdown_timeout', { action: 'graceful_shutdown_timeout', signal });
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  try {
    // Stop accepting new WS connections and close existing ones.
    if (wss) {
      for (const client of wss.clients) {
        try {
          client.close(1001, 'Server shutting down');
        } catch {
          /* ignore */
        }
      }
      await new Promise((resolve) => wss.close(() => resolve()));
    }
    // Stop accepting new HTTP connections, then drain in-flight ones.
    await new Promise((resolve) => server.close(() => resolve()));
    // Close the database connection last so in-flight requests can finish.
    await disconnectDB();
    logger.info('graceful_shutdown_complete', { action: 'graceful_shutdown_complete', signal });
    clearTimeout(forceTimer);
    process.exit(0);
  } catch (error) {
    logger.error('graceful_shutdown_error', {
      action: 'graceful_shutdown_error',
      signal,
      error: error.message,
    });
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
