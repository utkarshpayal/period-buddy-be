import nodemailer from 'nodemailer';
import logger from './logger.js';

let transporter = null;
let attemptedInit = false;

const isConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (attemptedInit) return transporter;
  attemptedInit = true;

  if (!isConfigured()) {
    logger.warn('mailer_not_configured', {
      action: 'mailer_not_configured',
      message: 'SMTP_HOST/SMTP_USER/SMTP_PASS not set — emails will be logged instead of sent',
    });
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
};

/**
 * Sends an email. Falls back to a structured log entry when SMTP isn't
 * configured (local/dev), so the surrounding request can still succeed.
 */
export const sendMail = async ({ to, subject, html, text, replyTo }) => {
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    logger.info('mail_skipped_not_configured', {
      action: 'mail_skipped_not_configured',
      to,
      subject,
    });
    return { delivered: false, reason: 'not_configured' };
  }

  try {
    await activeTransporter.sendMail({
      from: process.env.MAIL_FROM || `"Nura" <${process.env.SMTP_USER}>`,
      to,
      replyTo,
      subject,
      html,
      text,
    });

    logger.info('mail_sent', { action: 'mail_sent', to, subject });
    return { delivered: true };
  } catch (error) {
    logger.error('mail_send_failed', {
      action: 'mail_send_failed',
      to,
      subject,
      error: error.message,
    });
    return { delivered: false, reason: 'send_failed' };
  }
};
