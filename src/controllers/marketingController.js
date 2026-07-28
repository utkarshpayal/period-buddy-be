import Newsletter from '../models/Newsletter.js';
import ContactMessage from '../models/ContactMessage.js';
import { sendMail } from '../utils/mailer.js';
import {
  getNewsletterWelcomeTemplate,
  getContactNotificationTemplate,
} from '../templates/emailTemplates.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { buildPagination, getPagination } from '../utils/apiHelpers.js';

/** POST /api/newsletter/subscribe — Public: subscribe an email to the newsletter */
export const subscribeNewsletter = async (req, res, next) => {
  try {
    const { email } = req.body;

    const existing = await Newsletter.findOne({ email });
    if (existing) {
      if (existing.isActive) {
        return sendResponse(res, HTTP_STATUS.OK, "You're already subscribed!", {
          email: existing.email,
        });
      }
      existing.isActive = true;
      existing.unsubscribedAt = null;
      await existing.save();
      logger.info('newsletter_resubscribed', { action: 'newsletter_resubscribed', email });
      return sendResponse(res, HTTP_STATUS.OK, 'Welcome back! Subscribed successfully.', {
        email: existing.email,
      });
    }

    const subscription = await Newsletter.create({ email, source: 'marketing_website' });

    sendMail({
      to: email,
      subject: "You're on the list — welcome to Nura",
      html: getNewsletterWelcomeTemplate(),
      text: "Thanks for subscribing to Nura's newsletter. You'll get our science advisory board's research articles once a month.",
    }).catch((error) =>
      logger.error('newsletter_welcome_mail_failed', {
        action: 'newsletter_welcome_mail_failed',
        error: error.message,
      }),
    );

    logger.info('newsletter_subscribed', { action: 'newsletter_subscribed', email });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Subscribed! Check your inbox soon.', {
      email: subscription.email,
    });
  } catch (error) {
    if (error.code === 11000) {
      return sendResponse(res, HTTP_STATUS.OK, "You're already subscribed!", {
        email: req.body.email,
      });
    }
    next(error);
  }
};

/** POST /api/newsletter/unsubscribe — Public: unsubscribe an email */
export const unsubscribeNewsletter = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Email is required');

    const subscription = await Newsletter.findOneAndUpdate(
      { email: String(email).trim().toLowerCase() },
      { isActive: false, unsubscribedAt: new Date() },
      { new: true },
    );

    if (!subscription) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Subscription not found');

    logger.info('newsletter_unsubscribed', { action: 'newsletter_unsubscribed', email });

    return sendResponse(res, HTTP_STATUS.OK, "You've been unsubscribed.");
  } catch (error) {
    next(error);
  }
};

/** GET /api/newsletter — Admin: list subscribers */
export const getNewsletterSubscribers = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const filter = { isActive: true };

    const [subscribers, total] = await Promise.all([
      Newsletter.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Newsletter.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Subscribers fetched', {
      subscribers,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/contact — Public: submit the contact form, persist it, and email the team */
export const submitContactMessage = async (req, res, next) => {
  try {
    const { name, email, topic, message } = req.body;

    const contactMessage = await ContactMessage.create({ name, email, topic, message });

    const receiver = process.env.CONTACT_RECEIVER_EMAIL || process.env.SMTP_USER;
    let emailDelivered = false;

    if (receiver) {
      const result = await sendMail({
        to: receiver,
        replyTo: email,
        subject: `Nura Contact`,
        html: getContactNotificationTemplate({ name, email, topic, message }),
        text: `New contact form submission\n\nName: ${name}\nEmail: ${email}\nTopic: ${topic || 'General question'}\n\nMessage:\n${message}`,
      });
      emailDelivered = result.delivered;

      if (emailDelivered) {
        contactMessage.emailDelivered = true;
        await contactMessage.save();
      }
    }

    logger.info('contact_message_submitted', {
      action: 'contact_message_submitted',
      id: contactMessage._id,
      email,
      topic,
      emailDelivered,
    });

    return sendResponse(
      res,
      HTTP_STATUS.CREATED,
      'Got it — thank you! Someone from the team will get back to you soon.',
      {
        id: contactMessage._id,
      },
    );
  } catch (error) {
    next(error);
  }
};

/** GET /api/contact — Admin: list contact messages */
export const getContactMessages = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const { status } = req.query;

    const filter = {};
    if (status) filter.status = status;

    const [messages, total] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ContactMessage.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Contact messages fetched', {
      messages,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/contact/:id/status — Admin: update a contact message's status */
export const updateContactMessageStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['new', 'read', 'resolved'].includes(status)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid status');
    }

    const contactMessage = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );
    if (!contactMessage) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Contact message not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Status updated', contactMessage);
  } catch (error) {
    next(error);
  }
};
