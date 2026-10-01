import DoctorPayout from '../models/DoctorPayout.js';
import logger from '../utils/logger.js';
import { verifyPayoutWebhook } from '../utils/cashfreePayoutClient.js';
import { syncPayout } from '../utils/doctorWallet.js';

/**
 * POST /api/payouts/webhook/cashfree — Cashfree Payouts V2 webhook (public;
 * mounted in index.js with express.raw so the signature can be checked
 * against the exact bytes).
 *
 * The body is only used to find which payout changed. Its status is then
 * fetched from Cashfree (syncPayout), so a replayed or reordered webhook
 * can't move a payout anywhere Cashfree doesn't say it is.
 */
export const cashfreePayoutWebhook = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const ok = verifyPayoutWebhook({
    rawBody,
    signature: req.get('x-webhook-signature'),
    timestamp: req.get('x-webhook-timestamp'),
  });
  if (!ok) {
    logger.warn('cashfree_payout_webhook_bad_signature', {
      action: 'cashfree_payout_webhook_bad_signature',
      ip: req.ip,
    });
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  const type = payload?.type;
  const transferId = payload?.data?.transfer_id;

  if (type === 'LOW_BALANCE_ALERT') {
    logger.error('cashfree_payout_low_balance', {
      action: 'cashfree_payout_low_balance',
      message: 'Cashfree Payouts balance is low; top it up before approving withdrawals',
    });
  }

  if (transferId) {
    const payout = await DoctorPayout.findOne({ transferId }).select('_id').lean();
    if (payout) {
      try {
        await syncPayout(payout._id);
      } catch (error) {
        // Acknowledge anyway: the runner re-checks this payout on its own.
        logger.error('cashfree_payout_webhook_sync_failed', {
          action: 'cashfree_payout_webhook_sync_failed',
          transferId,
          error: error.message,
        });
      }
    }
  }

  logger.info('cashfree_payout_webhook', { action: 'cashfree_payout_webhook', type, transferId });
  return res.status(200).json({ success: true });
};
