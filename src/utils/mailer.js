import { Resend } from 'resend';
import logger from './logger.js';

let resendInstance = null;
let attemptedInit = false;

const isConfigured = () => Boolean(process.env.RESEND_API_KEY);

const getResendInstance = () => {
  if (attemptedInit) return resendInstance;
  attemptedInit = true;

  if (!isConfigured()) {
    logger.warn('mailer_not_configured', {
      action: 'mailer_not_configured',
      message: 'RESEND_API_KEY not set — emails will be logged instead of sent',
    });
    return null;
  }

  resendInstance = new Resend(process.env.RESEND_API_KEY);
  return resendInstance;
};

/**
 * Sends an email using the Resend SDK.
 * Falls back to logging when Resend isn't configured in dev.
 */
export const sendMail = async ({ to, subject, html, text, replyTo }) => {
  const resend = getResendInstance();

  if (!resend) {
    logger.info('mail_skipped_not_configured', {
      action: 'mail_skipped_not_configured',
      to,
      subject,
    });
    return { delivered: false, reason: 'not_configured' };
  }

  try {
    const response = await resend.emails.send({
      from: process.env.MAIL_FROM || 'Nura <onboarding@resend.dev>',
      to,
      subject,
      html,
      text,
      reply_to: replyTo,
    });

    if (response.error) {
      logger.error('mail_send_failed', {
        action: 'mail_send_failed',
        to,
        subject,
        error: response.error.message,
      });
      return { delivered: false, reason: 'send_failed' };
    }

    logger.info('mail_sent', { 
      action: 'mail_sent', 
      to, 
      subject, 
      id: response.data?.id 
    });
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
