/**
 * Move chat kept in the deprecated `Consultation.messages` array (plain text)
 * into ConsultationMessage, where text is encrypted, then remove the array.
 *
 *   node src/scripts/migrateConsultationMessages.js            # dry run: counts only
 *   node src/scripts/migrateConsultationMessages.js --apply    # move and remove
 *
 * Needs DATA_ENCRYPTION_KEYS in production (ConsultationMessage encrypts on
 * save). Idempotent: a consultation that already has ConsultationMessage rows
 * only gets its legacy array removed (those rows are the same conversation,
 * written alongside it). Back up the database first.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/database.js';
import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';

const apply = process.argv.includes('--apply');

const run = async () => {
  await connectDB();
  const raw = Consultation.collection;
  const cursor = raw.find({ 'messages.0': { $exists: true } }, { projection: { messages: 1 } });
  let consultations = 0;
  let moved = 0;
  for await (const row of cursor) {
    consultations += 1;
    const existing = await ConsultationMessage.countDocuments({ consultationId: row._id });
    const legacy = (row.messages || []).filter(
      (m) => m && typeof m.text === 'string' && m.text.trim(),
    );
    if (existing === 0 && legacy.length) {
      moved += legacy.length;
      if (apply) {
        await ConsultationMessage.insertMany(
          legacy.map((m) => ({
            consultationId: row._id,
            sender: m.sender === 'doctor' ? 'doctor' : 'user',
            text: m.text.trim().slice(0, 3000),
            sentAt: m.sentAt ? new Date(m.sentAt) : new Date(),
          })),
        );
      }
    }
    if (apply) await raw.updateOne({ _id: row._id }, { $unset: { messages: '' } });
  }
  console.log(
    `${apply ? 'Done' : 'Dry run'}: ${consultations} consultations with a legacy messages array, ` +
      `${moved} messages ${apply ? 'moved' : 'to move'} into ConsultationMessage.`,
  );
  if (!apply) console.log('Run again with --apply to move them and remove the arrays.');
  await disconnectDB();
};

run().catch(async (error) => {
  console.error(error);
  await disconnectDB();
  process.exit(1);
});
