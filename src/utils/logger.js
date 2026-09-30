import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../../logs');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

/* ─── Redaction ──────────────────────────────────────────── */
// Logs go to files and CloudWatch, where far more people and systems can
// read them than can read the database. Secrets never appear; emails and
// phone numbers are masked; message and note text (health data) is dropped.
const SECRET_KEYS =
  /^(password|newPassword|currentPassword|otp|token|fcmToken|authorization|accessToken|refreshToken|secret|apiKey|callToken)$/i;
const CONTENT_KEYS =
  /^(text|note|content|body|message_text|transcript|extractedText|answer|question)$/i;
const maskEmail = (v) => String(v).replace(/^(.).*?(@.*)?$/, (_m, a, d) => `${a}***${d || ''}`);
const maskPhone = (v) => `•••${String(v).replace(/\D/g, '').slice(-2)}`;

export const redact = (value, key = '', depth = 0) => {
  if (value == null || depth > 6) return value;
  if (SECRET_KEYS.test(key)) return '[redacted]';
  if (CONTENT_KEYS.test(key) && typeof value === 'string') return `[${value.length} chars]`;
  if (/email/i.test(key) && typeof value === 'string') return maskEmail(value);
  if (/phone/i.test(key) && typeof value === 'string') return maskPhone(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, key, depth + 1));
  if (typeof value === 'object' && !(value instanceof Date) && !(value instanceof Error)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, depth + 1)]));
  }
  return value;
};

const redactFormat = winston.format((info) => {
  for (const [k, v] of Object.entries(info)) {
    if (k === 'level' || k === 'message' || k === 'stack' || k === 'timestamp') continue;
    info[k] = redact(v, k);
  }
  return info;
});

/* ─── Log Format ─────────────────────────────────────────── */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${stack || message}${metaStr}`;
  }),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

/* ─── Transports ─────────────────────────────────────────── */
const consoleFormat = process.env.NODE_ENV === 'production' ? prodFormat : devFormat;

const transports = [new winston.transports.Console({ format: consoleFormat })];

// Size-capped: in a long-lived container these files otherwise grow until
// the disk fills. The console transport (→ CloudWatch via Docker's awslogs
// driver, deploy/docker-compose.yml) remains the primary log stream.
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 5;

if (process.env.NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
      tailable: true,
    }),
  );
}

/* ─── Logger Instance ────────────────────────────────────── */
const logger = winston.createLogger({
  // Applied before every transport's own format: console and files alike.
  format: redactFormat(),
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transports,
});

// Crashes (including one while the app is still loading, before index.js
// registers its own handlers) go through a logger of their own: winston
// skips a handler transport's format when the logger has a format (the
// redaction above), and a crash then printed only "undefined".
winston.createLogger({
  exceptionHandlers: [new winston.transports.Console({ format: consoleFormat })],
  rejectionHandlers: [new winston.transports.Console({ format: consoleFormat })],
});

export default logger;
