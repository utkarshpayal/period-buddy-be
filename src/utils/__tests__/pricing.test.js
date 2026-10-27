import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREMIUM_FAMILY,
  PREMIUM_FEATURE_KEYS,
  PRICING_2026,
  accessStart,
  annualComparison,
  expiryFrom,
  foundingEligibility,
  limitFor,
  maxPagesFor,
  periodKey,
  periodResetsAt,
  promoStatus,
  resolveUnlockedKeys,
  taxBreakdown,
  usageTier,
} from '../pricing.js';

const NOW = new Date('2026-10-24T06:30:00.000Z'); // 12:00 IST
const days = (n) => new Date(NOW.getTime() + n * 86400000);
const premiumPlan = { family: PREMIUM_FAMILY, features: PREMIUM_FEATURE_KEYS };
const planEnt = (over = {}) => ({
  source: 'plan',
  plan: premiumPlan,
  status: 'active',
  expiresAt: days(10),
  ...over,
});

test('annual plan: ₹799/year vs 12 × ₹99 saves ₹389 (32.7%), ≈ ₹66.58/month', () => {
  assert.deepEqual(annualComparison(99, 799), {
    twelveMonthly: 1188,
    monthlyEquivalent: 66.58,
    saving: 389,
    savingPercent: 32.7,
  });
});

test('add-on annual prices are ten months of the monthly price', () => {
  for (const [key, f] of Object.entries(PRICING_2026.features)) {
    if (f.yearlyPrice) assert.equal(f.yearlyPrice, f.price * 10, key);
  }
  assert.equal(annualComparison(29, 290).saving, 58);
});

test('no saving is claimed when yearly is not cheaper', () => {
  assert.equal(annualComparison(10, 120).saving, null);
  assert.equal(annualComparison(10, 130).savingPercent, null);
});

test('catalog: Premium is ₹99 / ₹799, founding ₹499 off by default and renews to yearly', () => {
  const bySlug = Object.fromEntries(PRICING_2026.plans.map((p) => [p.slug, p]));
  assert.equal(bySlug['premium-monthly'].price, 99);
  assert.equal(bySlug['premium-yearly'].price, 799);
  const founding = bySlug['premium-founding'];
  assert.equal(founding.price, 499);
  assert.equal(founding.isActive, false);
  assert.equal(founding.promo.maxRedemptions, 500);
  assert.equal(founding.promo.renewalPlanSlug, 'premium-yearly');
  assert.ok(!PREMIUM_FEATURE_KEYS.includes('voice_checkin_calls'));
  assert.equal(PRICING_2026.features.community_posting.isPremium, false);
  assert.equal(PRICING_2026.features.government_scheme_applications.isPremium, false);
});

test('tax: prices include 18% GST by default, so ₹99 charges ₹99 with ₹15.10 GST', () => {
  assert.deepEqual(taxBreakdown(99), {
    base: 83.9,
    tax: 15.1,
    total: 99,
    inclusive: true,
    ratePercent: 18,
  });
  assert.equal(taxBreakdown(799).tax, 121.88);
  const exclusive = taxBreakdown(99, { ratePercent: 18, pricesIncludeTax: false });
  assert.equal(exclusive.total, 116.82);
  assert.equal(taxBreakdown(99, { ratePercent: 0 }).tax, 0);
});

test('promo status: only the real cap and end date limit the founding offer', () => {
  const plan = {
    isActive: true,
    promo: { kind: 'founding', maxRedemptions: 500, redeemedCount: 499, endsAt: days(1) },
  };
  assert.deepEqual(promoStatus(plan, NOW), { available: true, reason: null });
  assert.equal(promoStatus({ ...plan, isActive: false }, NOW).reason, 'inactive');
  assert.equal(
    promoStatus({ ...plan, promo: { ...plan.promo, redeemedCount: 500 } }, NOW).reason,
    'sold_out',
  );
  assert.equal(
    promoStatus({ ...plan, promo: { ...plan.promo, endsAt: days(-1) } }, NOW).reason,
    'ended',
  );
  assert.equal(
    promoStatus({ isActive: true, promo: { kind: 'founding', maxRedemptions: null } }, NOW)
      .available,
    true,
  );
  assert.equal(promoStatus({ isActive: true }, NOW).available, true);
});

test('founding eligibility: new members only, once per account and per phone', () => {
  const status = { available: true, reason: null };
  assert.equal(foundingEligibility({ status }).eligible, true);
  assert.equal(foundingEligibility({ status, hadPaidPremium: true }).reason, 'existing_member');
  assert.equal(foundingEligibility({ status, usedFounding: true }).reason, 'already_used');
  assert.equal(foundingEligibility({ status, phoneUsedFounding: true }).reason, 'already_used');
  assert.equal(
    foundingEligibility({ status: { available: false, reason: 'sold_out' } }).reason,
    'sold_out',
  );
});

test('renewing early extends access instead of overlapping paid time', () => {
  const current = [planEnt({ expiresAt: days(10) })];
  const start = accessStart(current, { family: PREMIUM_FAMILY }, NOW);
  assert.equal(start.getTime(), days(10).getTime());
  assert.equal(expiryFrom('monthly', start).getTime(), days(40).getTime());
  assert.equal(expiryFrom('yearly', NOW).getTime(), days(365).getTime());
  assert.equal(expiryFrom('one_time', NOW), null);
  // Expired, refunded or other features don't push the start.
  const ignored = [
    planEnt({ expiresAt: days(-1) }),
    planEnt({ status: 'refunded', expiresAt: days(20) }),
    { source: 'feature', featureKey: 'ai_assistant', status: 'active', expiresAt: days(30) },
  ];
  assert.equal(accessStart(ignored, { family: PREMIUM_FAMILY }, NOW).getTime(), NOW.getTime());
  assert.equal(
    accessStart(ignored, { featureKey: 'ai_assistant' }, NOW).getTime(),
    days(30).getTime(),
  );
});

test('entitlements: no subscription, monthly, yearly, expired, promo, add-on, refunded', () => {
  const base = { subscriptionEnabled: true, freeKeys: ['community_posting'], now: NOW };
  const keys = (entitlements) => [...resolveUnlockedKeys({ ...base, entitlements })].sort();

  assert.deepEqual(keys([]), ['community_posting']);
  for (const billingCycle of ['monthly', 'yearly']) {
    const unlocked = keys([planEnt({ billingCycle })]);
    for (const key of PREMIUM_FEATURE_KEYS)
      assert.ok(unlocked.includes(key), `${billingCycle} ${key}`);
  }
  assert.deepEqual(keys([planEnt({ expiresAt: days(-1) })]), ['community_posting']);
  assert.ok(
    keys([planEnt({ plan: { ...premiumPlan, promo: { kind: 'founding' } } })]).includes(
      'document_chat',
    ),
  );
  assert.deepEqual(
    keys([{ source: 'feature', featureKey: 'partner_connect', status: 'active', expiresAt: null }]),
    ['community_posting', 'partner_connect'],
  );
  for (const status of ['refunded', 'failed', 'pending', 'cancelled', 'expired']) {
    assert.deepEqual(keys([planEnt({ status })]), ['community_posting'], status);
  }
  assert.equal(
    resolveUnlockedKeys({ ...base, subscriptionEnabled: false, entitlements: [] }),
    'ALL',
  );
});

test('usage tier follows a live plan, and everyone is premium while subscriptions are off', () => {
  assert.equal(usageTier({ subscriptionEnabled: true, entitlements: [], now: NOW }), 'free');
  assert.equal(
    usageTier({ subscriptionEnabled: true, entitlements: [planEnt()], now: NOW }),
    'premium',
  );
  assert.equal(
    usageTier({
      subscriptionEnabled: true,
      entitlements: [planEnt({ expiresAt: days(-1) })],
      now: NOW,
    }),
    'free',
  );
  const addOn = {
    source: 'feature',
    featureKey: 'ai_assistant',
    status: 'active',
    expiresAt: days(5),
  };
  assert.equal(usageTier({ subscriptionEnabled: true, entitlements: [addOn], now: NOW }), 'free');
  assert.equal(usageTier({ subscriptionEnabled: false, entitlements: [], now: NOW }), 'premium');
});

test('fair-use limits are off by default and read per tier when on', () => {
  const fairUse = {
    enabled: true,
    aiMessagesPerDay: { free: 20, premium: 100 },
    documentsPerMonth: { free: 2, premium: 2 },
    maxPagesPerDocument: { free: 5, premium: 5 },
  };
  assert.equal(limitFor({ ...fairUse, enabled: false }, 'ai_message', 'free'), null);
  assert.equal(limitFor(fairUse, 'ai_message', 'free'), 20);
  assert.equal(limitFor(fairUse, 'ai_message', 'premium'), 100);
  assert.equal(limitFor(fairUse, 'document_upload', 'premium'), 2);
  assert.equal(limitFor(fairUse, 'doctor_report', 'premium'), null);
  assert.equal(limitFor(fairUse, 'unknown', 'free'), null);
  assert.equal(maxPagesFor(fairUse, 'premium'), 5);
  assert.equal(maxPagesFor({ ...fairUse, enabled: false }, 'premium'), null);
});

test('usage periods follow the India calendar', () => {
  // 23:00 UTC on 31 Oct is already 1 Nov in India.
  const lateUtc = new Date('2026-10-31T23:00:00.000Z');
  assert.equal(periodKey('day', lateUtc), 'd:2026-11-01');
  assert.equal(periodKey('month', lateUtc), 'm:2026-11');
  assert.equal(periodKey('month', NOW), 'm:2026-10');
  assert.equal(periodResetsAt('day', NOW).toISOString(), '2026-10-24T18:30:00.000Z');
  assert.equal(periodResetsAt('month', NOW).toISOString(), '2026-10-31T18:30:00.000Z');
});

test('the seed catalog carries the same add-on prices as PRICING_2026', async () => {
  const { subscriptionFeatureData } = await import('../subscriptionSeedData.js');
  for (const [key, target] of Object.entries(PRICING_2026.features)) {
    const seed = subscriptionFeatureData.find((f) => f.key === key);
    assert.ok(seed, key);
    assert.equal(seed.price, target.price, key);
    assert.equal(seed.yearlyPrice, target.yearlyPrice, key);
  }
});
