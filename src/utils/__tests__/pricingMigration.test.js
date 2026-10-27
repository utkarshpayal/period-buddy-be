import test from 'node:test';
import assert from 'node:assert/strict';
import { planPricingChanges } from '../pricingMigration.js';

const oldFeatures = [
  { key: 'ai_assistant', isPremium: true, price: 99, billingCycle: 'monthly' },
  { key: 'symptom_checker', isPremium: false, price: 49, billingCycle: 'one_time' },
  { key: 'community_posting', isPremium: true, price: 29, billingCycle: 'monthly' },
  { key: 'voice_checkin_calls', isPremium: true, price: 199, billingCycle: 'monthly' },
];

test('fresh catalog: creates the three Premium plans, founding switched off', () => {
  const plan = planPricingChanges({ features: oldFeatures, plans: [] });
  assert.deepEqual(
    plan.planCreates.map((p) => [p.slug, p.price, p.isActive]),
    [
      ['premium-monthly', 99, true],
      ['premium-yearly', 799, true],
      ['premium-founding', 499, false],
    ],
  );
});

test('feature prices move to the new add-on prices; voice calls are left alone', () => {
  const { featureUpdates, missingFeatures } = planPricingChanges({
    features: oldFeatures,
    plans: [],
  });
  const byKey = Object.fromEntries(featureUpdates.map((u) => [u.key, u]));
  assert.deepEqual(byKey.ai_assistant.set, { price: 29, yearlyPrice: 290 });
  assert.equal(byKey.symptom_checker.startsCharging, true);
  assert.equal(byKey.symptom_checker.set.billingCycle, 'monthly');
  assert.equal(byKey.community_posting.becomesFree, true);
  assert.equal(byKey.voice_checkin_calls, undefined);
  assert.ok(missingFeatures.includes('document_chat'));
});

test('an admin-activated founding offer stays as the admin set it', () => {
  const plans = [
    {
      slug: 'premium-founding',
      name: 'Nura Premium, founding member',
      description: 'Your first year of Premium at a founding-member price.',
      family: 'premium',
      price: 499,
      billingCycle: 'yearly',
      isActive: true,
      features: [
        'ai_assistant',
        'document_chat',
        'health_reports',
        'symptom_checker',
        'symptom_predictions',
        'partner_connect',
        'period_buddy',
      ],
      promo: {
        kind: 'founding',
        maxRedemptions: 500,
        renewalPlanSlug: 'premium-yearly',
        redeemedCount: 120,
      },
    },
  ];
  const { planUpdates } = planPricingChanges({ features: [], plans });
  assert.equal(
    planUpdates.find((u) => u.slug === 'premium-founding'),
    undefined,
  );
});

test('old plans are listed, and only switched off when asked', () => {
  const plans = [
    { slug: 'premium', name: 'Premium', price: 99, billingCycle: 'monthly', isActive: true },
  ];
  assert.deepEqual(planPricingChanges({ features: [], plans }).retire, []);
  const retiring = planPricingChanges({ features: [], plans }, { retireOldPlans: true });
  assert.deepEqual(
    retiring.oldPlans.map((p) => p.slug),
    ['premium'],
  );
  assert.deepEqual(retiring.retire, ['premium']);
});

test('already on the new pricing: nothing to change', () => {
  const first = planPricingChanges({ features: [], plans: [] });
  const plans = first.planCreates.map((p) => ({ ...p, promo: p.promo && { ...p.promo } }));
  const again = planPricingChanges({ features: [], plans });
  assert.deepEqual(again.planCreates, []);
  assert.deepEqual(again.planUpdates, []);
});
