import express from 'express';
import * as supportController from '../controllers/supportController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { noopLimiter, rateLimitEnabled, supportTicketLimiter } from '../middleware/rateLimiters.js';

// Help & support tickets raised from the app (Profile → Help & support).
// Every route is the signed-in person's own tickets; someone else's answers 404.
const router = express.Router();
const ticketLimiter = rateLimitEnabled ? supportTicketLimiter : noopLimiter;

router.use(authenticate);

/**
 * @route   GET /api/support/categories
 * @desc    Ticket categories for the Help & support form
 * @access  Private
 */
router.get('/categories', supportController.listCategories);

/**
 * @route   POST /api/support/tickets
 * @desc    Open a support ticket. Body: { category, subject, message, attachAppInfo?, meta? }. Emails the support inbox and sends the person a confirmation. Rate-limited
 * @access  Private
 */
router.post('/tickets', ticketLimiter, supportController.createTicket);

/**
 * @route   GET /api/support/tickets
 * @desc    The caller's tickets, latest activity first (?status=open|in_progress|resolved|closed|active &page= &limit=), plus unreadCount
 * @access  Private
 */
router.get('/tickets', supportController.listMyTickets);

/**
 * @route   GET /api/support/tickets/:id
 * @desc    One of the caller's tickets with its reply thread; marks support's replies read
 * @access  Private (owner)
 */
router.get('/tickets/:id', supportController.getMyTicket);

/**
 * @route   POST /api/support/tickets/:id/reply
 * @desc    Add a message to the caller's ticket. Body: { message }. Re-opens a resolved ticket; 409 when closed
 * @access  Private (owner)
 */
router.post('/tickets/:id/reply', ticketLimiter, supportController.replyToMyTicket);

export default router;
