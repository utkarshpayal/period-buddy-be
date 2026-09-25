import logger from './logger.js';

// "sandbox" while on test credentials, "production" once live — also
// controls which API host is hit and is passed straight through to the
// frontend's Cashfree JS SDK (Cashfree({ mode }) needs to match the order's
// environment or checkout fails).
const CASHFREE_ENV = process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox';
const API_BASE =
  CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const API_VERSION = '2023-08-01';

export const isPaymentConfigured = () =>
  Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);

export const cashfreeMode = () => CASHFREE_ENV;

// Some payment methods (netbanking, wallets, and UPI apps opened via an
// intent link) don't resolve inside Cashfree's `_modal` target the way UPI
// Collect and cards do — Cashfree navigates the *page* itself to
// order_meta.return_url once the bank/app hands control back, and if that's
// missing the checkout just hangs on whatever page the redirect landed on.
// The app's CashfreeCheckoutModal intercepts navigation to this URL via
// onShouldStartLoadWithRequest before it ever loads, so the content here is
// only a fallback for the rare case that interception misses it (e.g. a
// WebView quirk) — hence a plain static page rather than another API route.
// Strip a trailing slash — a base URL with one would otherwise produce
// "…//api/payments/return", which Express's router treats as a distinct,
// non-matching path (it doesn't collapse repeated slashes), silently
// 404ing the fallback return page.
const RETURN_URL_BASE =
  (process.env.CASHFREE_RETURN_URL_BASE || process.env.API_BASE_URL || '').replace(/\/+$/, '') ||
  undefined;

const authHeaders = () => {
  if (!isPaymentConfigured()) {
    throw new Error(
      'Payments are not configured on the server (missing CASHFREE_APP_ID/CASHFREE_SECRET_KEY)',
    );
  }
  return {
    'x-client-id': process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'x-api-version': API_VERSION,
    'Content-Type': 'application/json',
  };
};

/** Creates a Cashfree order (whole-unit amount, e.g. rupees — unlike
 * Razorpay, Cashfree does not want paise). The frontend opens its checkout
 * against the returned `payment_session_id` — no money moves until the user
 * completes that checkout. UPI (intent + collect), cards, netbanking and
 * wallets are all offered automatically by Cashfree's hosted checkout;
 * nothing extra to configure here for UPI specifically. */
export const createOrder = async ({ orderId, amount, currency, customer, notes }) => {
  try {
    const response = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: currency,
        customer_details: {
          customer_id: String(customer.id),
          customer_name: customer.name || 'Nura user',
          customer_email: customer.email || 'hello@thenura.care',
          customer_phone: customer.phone || '9999999999',
        },
        order_note: notes ? JSON.stringify(notes) : undefined,
        // {order_id} is a Cashfree-recognized placeholder — it substitutes
        // the real order_id before redirecting. Required for redirect-based
        // methods even under redirectTarget "_modal"; without it those
        // methods never signal completion back to the checkout page.
        order_meta: RETURN_URL_BASE
          ? { return_url: `${RETURN_URL_BASE}/api/payments/return?order_id={order_id}` }
          : undefined,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || `Cashfree order creation failed (${response.status})`);
    }
    return data;
  } catch (error) {
    logger.error('cashfree_create_order_failed', {
      action: 'cashfree_create_order_failed',
      error: error.message,
    });
    throw new Error('Failed to create payment order', { cause: error });
  }
};

/** Fetches an order's live status directly from Cashfree — this is what
 * proves a payment actually happened; unlike Razorpay's HMAC signature
 * scheme, Cashfree checkout doesn't hand the client anything crypto-signed
 * to relay back, so verification here re-queries Cashfree by orderId
 * instead of validating a client-supplied signature. */
export const getOrderStatus = async (orderId) => {
  try {
    const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || `Cashfree order lookup failed (${response.status})`);
    }
    return data;
  } catch (error) {
    logger.error('cashfree_get_order_status_failed', {
      action: 'cashfree_get_order_status_failed',
      orderId,
      error: error.message,
    });
    throw new Error('Failed to fetch payment order status', { cause: error });
  }
};
