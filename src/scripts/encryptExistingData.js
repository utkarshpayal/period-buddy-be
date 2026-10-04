/**
 * Encrypt health data stored before field encryption existed, and re-encrypt
 * values still under an older key after a rotation (utils/fieldEncryption.js).
 *
 *   node src/scripts/encryptExistingData.js            # dry run: counts only
 *   node src/scripts/encryptExistingData.js --apply    # rewrite the rows
 *
 * Needs DATA_ENCRYPTION_KEYS (the first key is the one it encrypts with).
 * Idempotent and safe to re-run or stop half way: every row is rewritten on
 * its own, and the app reads plain text and every listed key the whole time.
 * Back up the database first anyway.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/database.js';
import {
  activeKeyId,
  decryptValue,
  encryptValue,
  keyIdOf,
  mapPath,
  sealJson,
} from '../utils/fieldEncryption.js';
import QaChatSession from '../models/QaChatSession.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import Consultation from '../models/Consultation.js';
import DocumentChatMessage from '../models/DocumentChatMessage.js';
import ScreeningAssessment from '../models/ScreeningAssessment.js';
import CycleLog from '../models/CycleLog.js';
import PartnerMessage from '../models/PartnerMessage.js';
import BuddyMessage from '../models/BuddyMessage.js';
import CheckinCall from '../models/CheckinCall.js';
import Document from '../models/Document.js';
import User from '../models/User.js';

/**
 * Keep in step with the `encryptFields` plugin calls in the models. A third
 * entry lists the plugin's `json` paths (whole objects stored as encrypted JSON).
 */
export const ENCRYPTED = [
  [QaChatSession, ['title', 'messages.text']],
  [ConsultationMessage, ['text']],
  [Consultation, ['feedback']],
  [DocumentChatMessage, ['text']],
  [ScreeningAssessment, ['summary', 'doctorDiscussionSummary', 'answers'], ['answers']],
  [CycleLog, ['note']],
  [PartnerMessage, ['text']],
  [BuddyMessage, ['text']],
  [CheckinCall, ['summary']],
  [Document, ['extractedText']],
  [User, ['twoFactor.totpSecret', 'twoFactor.pendingTotpSecret']],
];

const apply = process.argv.includes('--apply');
const active = activeKeyId();
if (!active) {
  console.error('Set DATA_ENCRYPTION_KEYS first.');
  process.exit(1);
}

/** Up to date = encrypted with the active key (or empty). */
const current = (v) => typeof v !== 'string' || v === '' || keyIdOf(v) === active;
const reencrypt = (v) => (current(v) ? v : encryptValue(decryptValue(v)));

await connectDB();
let total = 0;
for (const [Model, fields, jsonFields = []] of ENCRYPTED) {
  const top = [...new Set(fields.map((f) => f.split('.')[0]))];
  let rows = 0;
  let stale = 0;
  const cursor = Model.collection.find(
    {},
    { projection: Object.fromEntries(top.map((f) => [f, 1])) },
  );
  for await (const raw of cursor) {
    rows += 1;
    // `raw` is this row's own copy: rewrite it in place (a structuredClone
    // would turn the chat messages' ObjectId _ids into plain objects).
    const next = raw;
    let changed = false;
    for (const path of fields) {
      mapPath(next, path, (v) => {
        const plainObject = jsonFields.includes(path) && v !== null && typeof v === 'object';
        const out = plainObject ? sealJson(v) : reencrypt(v);
        if (out !== v) changed = true;
        return out;
      });
    }
    if (!changed) continue;
    stale += 1;
    if (apply) {
      await Model.collection.updateOne(
        { _id: raw._id },
        { $set: Object.fromEntries(top.map((f) => [f, next[f]])) },
      );
    }
  }
  total += stale;
  console.log(
    `${Model.modelName.padEnd(22)} ${String(stale).padStart(7)} of ${rows} row(s) ${apply ? 'encrypted' : 'to encrypt'}`,
  );
}
await disconnectDB();
console.log(
  apply
    ? `\nDone: ${total} row(s) rewritten with key "${active}".`
    : `\nDry run. Re-run with --apply to rewrite ${total} row(s).`,
);
