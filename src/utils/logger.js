import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../../logs');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

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
const transports = [
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  }),
];

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
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transports,
  exceptionHandlers: [new winston.transports.Console()],
  rejectionHandlers: [new winston.transports.Console()],
});

export default logger;
