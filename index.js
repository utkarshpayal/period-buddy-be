import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { connectDB } from './src/config/database.js';
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

// Load environment variables
dotenv.config();

const app = express();

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
const corsOptions = {
  origin: true,
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate limiting — 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// HTTP request logging (Morgan → Winston)
app.use(httpLogger);

/* ──────────────────────────────────────────────────────────
   Health Check
────────────────────────────────────────────────────────── */
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Period Buddy API is running',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
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
initWebSocket(server);

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
process.on('unhandledRejection', (reason, promise) => {
  logger.error('unhandled_rejection', { action: 'unhandled_rejection', reason: String(reason) });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { action: 'uncaught_exception', error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('process_sigterm', { action: 'process_sigterm', message: 'SIGTERM received, shutting down gracefully' });
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('process_sigint', { action: 'process_sigint', message: 'SIGINT received, shutting down gracefully' });
  process.exit(0);
});

export default app;
