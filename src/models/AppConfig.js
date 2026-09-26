import mongoose from 'mongoose';

/**
 * AppConfig — the single document the App CMS edits (key: 'app'). Holds only
 * what an admin changed; utils/appConfig.js merges it over the catalog
 * defaults in constants/appCatalog.js, so an empty document means "the app
 * exactly as it ships". `version` goes up on every save so the app can tell
 * a cached copy is stale. Banners live in their own collection (AppBanner).
 */
// Who sees an item (evaluated in the app); see constants/appCatalog.js.
export const audienceSchema = new mongoose.Schema(
  {
    segment: { type: String, default: 'all' },
    platforms: { type: [String], default: [] },
    minAppVersion: { type: String, default: null },
    maxAppVersion: { type: String, default: null },
  },
  { _id: false },
);

export const actionSchema = new mongoose.Schema(
  {
    type: { type: String, default: 'none' },
    value: { type: String, default: null },
    fallbackUrl: { type: String, default: null },
  },
  { _id: false },
);

const featureSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    placement: { type: String, required: true },
    size: { type: String, default: 'small' },
    colorKey: { type: String },
    order: { type: Number, default: 0 },
    title: { type: String, default: null },
    description: { type: String, default: null },
    badge: { type: String, default: null },
    audience: { type: audienceSchema, default: undefined },
  },
  { _id: false },
);

// An admin-made link tile living in a hub next to the built-in features.
const customTileSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    icon: { type: String, required: true },
    colorKey: { type: String, required: true },
    placement: { type: String, required: true },
    size: { type: String, default: 'small' },
    order: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    badge: { type: String, default: null },
    action: { type: actionSchema, required: true },
    audience: { type: audienceSchema, default: undefined },
  },
  { _id: false },
);

const homeSectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    visible: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const appConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'app' },
    features: { type: [featureSchema], default: [] },
    customTiles: { type: [customTileSchema], default: [] },
    homeSections: { type: [homeSectionSchema], default: [] },
    // { light: { token: color }, dark: { token: color } } — overrides only.
    theme: {
      light: { type: mongoose.Schema.Types.Mixed, default: {} },
      dark: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    // App-wide switches (maintenance mode, update prompts); see DEFAULT_SETTINGS.
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Bumped on every change; the app compares it to its cached copy.
    version: { type: Number, default: 0 },
    // Per-section counters for the CMS's optimistic locking, so a banner or
    // theme save never makes an open Features editor look stale.
    sectionVersions: {
      features: { type: Number, default: 0 },
      homeSections: { type: Number, default: 0 },
      theme: { type: Number, default: 0 },
      settings: { type: Number, default: 0 },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);

export default mongoose.model('AppConfig', appConfigSchema);
