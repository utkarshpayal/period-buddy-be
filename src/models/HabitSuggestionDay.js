import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

// One day's habit suggestions for one person (utils/habitSuggestionsAi.js),
// made on the first Habits screen open of their local day and served
// unchanged for the rest of it. The suggestions' reasons come from health
// logs, so they're stored encrypted. Old days expire on their own.
const habitSuggestionDaySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dateKey: { type: String, required: true }, // the phone's local 'YYYY-MM-DD'
    source: { type: String, enum: ['ai', 'rules'], required: true },
    // [{ key, title, icon, category, rewardPoints, reason }]
    suggestions: { type: mongoose.Schema.Types.Mixed, default: [] },
    // { phase, goal } they were made for, so the list can be topped up live.
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Keys the person tapped "Not for me" on; hidden today, and their titles
    // aren't suggested again for SUGGESTION_WINDOW_DAYS.
    dismissed: { type: [String], default: [] },
    // true when AI was allowed but failed, so these are the rules' picks; the
    // AI is tried again after AI_RETRY_AFTER_MS (attemptedAt = last try).
    aiFailed: { type: Boolean, default: false },
    attemptedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  },
  { versionKey: false },
);

habitSuggestionDaySchema.index({ userId: 1, dateKey: 1 }, { unique: true });

habitSuggestionDaySchema.plugin(encryptFields, { json: ['suggestions', 'context'] });

export default mongoose.model('HabitSuggestionDay', habitSuggestionDaySchema);
