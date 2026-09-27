import express from 'express';
import * as partnerController from '../controllers/partnerController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/partner
 * @desc    Get or initialize partner profile
 * @access  Private
 */
router.get('/', authenticate, partnerController.getPartnerProfile);

/**
 * @route   POST /api/partner/invite
 * @desc    Generate a unique partner invite code (valid 48h)
 * @access  Private
 */
router.post('/invite', authenticate, partnerController.generateInviteCode);

/**
 * @route   POST /api/partner/connect
 * @desc    Connect with a partner using their invite code
 * @access  Private
 */
router.post('/connect', authenticate, partnerController.connectPartner);

/**
 * @route   PATCH /api/partner/permissions
 * @desc    Update data sharing permissions
 * @access  Private
 */
router.patch('/permissions', authenticate, partnerController.updatePermissions);

/**
 * @route   GET /api/partner/shared-data
 * @desc    Get partner's shared cycle data (respects permissions)
 * @access  Private
 */
router.get('/shared-data', authenticate, partnerController.getPartnerSharedData);

/**
 * @route   GET /api/partner/messages
 * @desc    Get partner chat messages
 * @access  Private
 */
router.get('/messages', authenticate, partnerController.getMessages);

/**
 * @route   POST /api/partner/message
 * @desc    Send a message to partner
 * @access  Private
 */
router.post('/message', authenticate, partnerController.sendMessage);

/**
 * @route   DELETE /api/partner/disconnect
 * @desc    Disconnect partner
 * @access  Private
 */
router.delete('/disconnect', authenticate, partnerController.disconnectPartner);

/**
 * @route   GET /api/partner/notifications
 * @desc    Get partner notifications
 * @access  Private
 */
router.get('/notifications', authenticate, partnerController.getNotifications);

/**
 * @route   POST /api/partner/notifications/read-all
 * @desc    Mark all of the signed-in user's notifications as read
 * @access  Private
 */
router.post('/notifications/read-all', authenticate, partnerController.markAllNotificationsAsRead);

/**
 * @route   POST /api/partner/notifications/:id/read
 * @desc    Mark partner notification as read
 * @access  Private
 */
router.post('/notifications/:id/read', authenticate, partnerController.markNotificationAsRead);

export default router;
