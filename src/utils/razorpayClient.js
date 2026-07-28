import Razorpay from 'razorpay';
import crypto from 'crypto';
import logger from './logger.js';

export const isPaymentConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

let client = null;
const getClient = () => {
  if (!isPaymentConfigured()) {
    throw new Error(
      'Payments are not configured on the server (missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET)',
    );
  }
  if (!client) {
    client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
};

/** Creates a Razorpay order for the given amount (in the currency's smallest
 * unit, e.g. paise for INR). The frontend opens its checkout against this
 * order id — no money moves until the user completes that checkout. */
export const createOrder = async ({ amountMinorUnits, currency, receipt, notes }) => {
  try {
    const order = await getClient().orders.create({
      amount: amountMinorUnits,
      currency,
      receipt,
      notes,
    });
    return order;
  } catch (error) {
    logger.error('razorpay_create_order_failed', {
      action: 'razorpay_create_order_failed',
      error: error.message,
    });
    throw new Error('Failed to create payment order', { cause: error });
  }
};

/** Verifies the signature Razorpay's checkout returns after a successful
 * payment, per https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/#3-verify-payment-signature
 * — this is what proves the payment actually happened and wasn't forged
 * client-side. */
export const verifySignature = ({ orderId, paymentId, signature }) => {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
};
