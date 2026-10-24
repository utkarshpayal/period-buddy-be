/**
 * Moves one database onto the 2026 pricing (utils/pricing.js#PRICING_2026):
 * Nura Premium ₹99/month and ₹799/year, the ₹499 founding-member offer
 * (created switched OFF), and the new add-on prices.
 *
 *   node src/scripts/applyPricing2026.js                      # dry run: what would change
 *   node src/scripts/applyPricing2026.js --apply              # write the changes
 *   node src/scripts/applyPricing2026.js --apply --retire-old-plans
 *                                                            # also hide old plans from sale
 *
 * Uses MONGODB_URI from .env, so check which database that is first. Run on
 * staging before production; production needs an explicit go-ahead.
 *
 * Never touches entitlements (people keep what they paid for, at the price
 * they paid, until it ends), the subscriptions master switch, or the founding
 * offer's on/off state. Features that newly require payment are flagged in
 * the dry run: they lock for free users the moment subscriptions are on.
 * Rules and tests: utils/pricingMigration.js.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import mongoose from 'mongoose';
import SubscriptionFeature from '../models/SubscriptionFeature.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import { getSettings } from '../utils/subscriptionAccess.js';
import { planPricingChanges } from '../utils/pricingMigration.js';

const apply = process.argv.includes('--apply');
const retireOldPlans = process.argv.includes('--retire-old-plans');
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
try {
  console.log(
    `${apply ? 'Applying' : 'Dry run (add --apply to write)'} on ${mongoose.connection.host}\n`,
  );
  const [features, plans, settings] = await Promise.all([
    SubscriptionFeature.find().lean(),
    SubscriptionPlan.find().lean(),
    getSettings(),
  ]);
  const changes = planPricingChanges({ features, plans }, { retireOldPlans });

  console.log(
    `Subscriptions master switch: ${settings.subscriptionEnabled ? 'ON' : 'off'} (not changed)\n`,
  );
  console.log('Features:');
  for (const u of changes.featureUpdates) {
    const note = u.startsCharging
      ? '  <- starts needing payment'
      : u.becomesFree
        ? '  <- becomes free'
        : '';
    console.log(`  ${u.key}: ${JSON.stringify(u.set)}${note}`);
  }
  if (!changes.featureUpdates.length) console.log('  (no changes)');
  if (changes.missingFeatures.length) {
    console.log(
      `  not in this database yet (the seeder adds them on start): ${changes.missingFeatures.join(', ')}`,
    );
  }
  console.log(
    '  voice_checkin_calls: not changed (minute packs need metering and a confirmed provider cost)',
  );

  console.log('\nPlans:');
  for (const p of changes.planCreates) {
    console.log(
      `  create ${p.slug}: ₹${p.price} ${p.billingCycle}${p.isActive ? '' : ' (switched off)'}`,
    );
  }
  for (const u of changes.planUpdates) console.log(`  update ${u.slug}: ${JSON.stringify(u.set)}`);
  for (const p of changes.oldPlans) {
    const fate = changes.retire.includes(p.slug)
      ? 'hide from sale'
      : 'left on sale (add --retire-old-plans to hide)';
    console.log(`  old plan ${p.slug} (₹${p.price} ${p.billingCycle}): ${fate}`);
  }

  if (!apply) {
    console.log('\nDry run. Nothing was written.');
  } else {
    for (const u of changes.featureUpdates) {
      await SubscriptionFeature.updateOne({ key: u.key }, { $set: u.set });
    }
    for (const p of changes.planCreates) await SubscriptionPlan.create(p);
    for (const u of changes.planUpdates)
      await SubscriptionPlan.updateOne({ slug: u.slug }, { $set: u.set });
    if (changes.retire.length) {
      await SubscriptionPlan.updateMany(
        { slug: { $in: changes.retire } },
        { $set: { isActive: false } },
      );
    }
    console.log('\nDone. The founding offer stays off until an admin switches it on.');
  }
} finally {
  await mongoose.disconnect();
}
