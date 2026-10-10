import logger from './logger.js';
import { reconcileEarnings, syncDuePayouts } from './doctorWallet.js';
import { syncConsultationRefunds } from './consultationRefunds.js';
import { expireReferralCredits, grantDueReferralRewards } from './referrals.js';

/**
 * Background safety net for doctor payouts (utils/doctorWallet.js):
 * - every 2 min: dispatch approved payouts whose send was deferred, and
 *   re-check processing ones with Cashfree (the webhook's backup);
 * - every 2 min: send consultation refunds that are due and re-check pending
 *   ones with Cashfree (utils/consultationRefunds.js);
 * - every 30 min: reconcileEarnings(), which repairs any consultation hook
 *   that failed; lapsed referral credits are marked expired, and referral
 *   rewards that are due (or whose grant failed) are given.
 * Everything it calls is idempotent and compare-and-set, so a second
 * instance or an overlapping webhook does no harm.
 */

const PAYOUT_TICK_MS = 2 * 60_000;
const RECONCILE_EVERY_TICKS = 15;

let handle = null;
let ticking = false;
let tickCount = 0;

const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    await syncDuePayouts();
    await syncConsultationRefunds();
    if (tickCount % RECONCILE_EVERY_TICKS === 0) {
      await reconcileEarnings();
      await expireReferralCredits();
      await grantDueReferralRewards();
    }
  } catch (error) {
    logger.error('payout_runner_tick_failed', {
      action: 'payout_runner_tick_failed',
      error: error.message,
    });
  } finally {
    tickCount += 1;
    ticking = false;
  }
};

/** Started from index.js with the other schedulers. */
export const startPayoutRunner = () => {
  if (handle) return;
  setTimeout(tick, 30_000).unref();
  handle = setInterval(tick, PAYOUT_TICK_MS);
  handle.unref();
};

export const stopPayoutRunner = () => {
  if (handle) clearInterval(handle);
  handle = null;
};
