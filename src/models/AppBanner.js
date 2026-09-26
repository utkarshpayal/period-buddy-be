import mongoose from 'mongoose';
import { BANNER_ACTIONS, BANNER_LAYOUTS, BANNER_PLACEMENTS } from '../constants/appCatalog.js';
import { audienceSchema } from './AppConfig.js';

/**
 * AppBanner — a promo/marketing card the App CMS places in the app (Home
 * top/middle slots or a hub screen). Live when `active` and inside the
 * optional startAt/endAt window; several in one placement show as a
 * carousel, highest `priority` first. `clickCount` is bumped by the app's
 * tap beacon (POST /api/app-config/banners/:id/click); `impressionCount` by
 * the batched view beacon (POST /api/app-config/banners/impressions).
 */
const appBannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 60 },
    subtitle: { type: String, default: null, maxlength: 140 },
    ctaLabel: { type: String, default: null, maxlength: 24 },
    imageUrl: { type: String, default: null },
    placement: { type: String, enum: BANNER_PLACEMENTS, required: true },
    layout: { type: String, enum: BANNER_LAYOUTS, default: 'card' },
    action: {
      type: { type: String, enum: BANNER_ACTIONS, default: 'none' },
      value: { type: String, default: null },
      fallbackUrl: { type: String, default: null },
    },
    audience: { type: audienceSchema, default: undefined },
    backgroundColor: { type: String, default: null },
    textColor: { type: String, default: null },
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    dismissible: { type: Boolean, default: false },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    clickCount: { type: Number, default: 0 },
    // Times the app showed it (once per app session per device), for CTR.
    impressionCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

appBannerSchema.index({ active: 1, placement: 1, priority: -1 });

export default mongoose.model('AppBanner', appBannerSchema);
