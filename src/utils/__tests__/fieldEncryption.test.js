import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  decryptValue,
  encryptFields,
  encryptValue,
  isEncrypted,
  keyIdOf,
  openJson,
  parseKeyring,
  sealJson,
  setKeyring,
} from '../fieldEncryption.js';

const key = () => crypto.randomBytes(32).toString('base64');
const k1 = key();
const k0 = key();
setKeyring(`k1:${k1},k0:${k0}`);

test('encrypt/decrypt round-trips, with a random IV each time', () => {
  const a = encryptValue('Heavy cramps since Tuesday');
  const b = encryptValue('Heavy cramps since Tuesday');
  assert.ok(isEncrypted(a));
  assert.notEqual(a, b);
  assert.equal(decryptValue(a), 'Heavy cramps since Tuesday');
  assert.equal(keyIdOf(a), 'k1');
  assert.equal(decryptValue('legacy plain text'), 'legacy plain text');
  assert.equal(encryptValue(''), '');
  assert.equal(encryptValue(null), null);
  assert.equal(encryptValue(a), a, 'never double-encrypts');
});

test('rotation: an old key still decrypts; tampering and unknown keys throw', () => {
  setKeyring(`k0:${k0}`);
  const old = encryptValue('note');
  setKeyring(`k2:${key()},k0:${k0}`);
  assert.equal(decryptValue(old), 'note');
  assert.equal(keyIdOf(encryptValue('x')), 'k2');
  const parts = old.split(':');
  parts[4] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptValue(parts.join(':')));
  setKeyring(`k9:${key()}`);
  assert.throws(() => decryptValue(old), /isn't in DATA_ENCRYPTION_KEYS/);
  setKeyring(`k1:${k1},k0:${k0}`);
});

test('parseKeyring rejects malformed keys', () => {
  assert.throws(() => parseKeyring('k1:short'));
  assert.throws(() => parseKeyring(`k1:${k1},k1:${k0}`), /twice/);
  assert.equal(parseKeyring('').active, null);
});

test('plugin: stored encrypted, read decrypted, maxlength on the plain text', async () => {
  const message = new mongoose.Schema({ text: { type: String, trim: true, maxlength: 20 } });
  const schema = new mongoose.Schema({
    note: { type: String, maxlength: 10 },
    title: String,
    messages: [message],
  });
  schema.plugin(encryptFields, { fields: ['note', 'title', 'messages.text'] });
  const Model = mongoose.model(`EncTest${Date.now()}`, schema);

  const doc = new Model({
    note: 'Spotting',
    title: 'Irregular',
    messages: [{ text: '  Is this normal?  ' }],
  });
  const raw = doc.toObject({ transform: false, getters: false });
  assert.ok(isEncrypted(raw.note));
  assert.ok(isEncrypted(raw.messages[0].text));
  assert.equal(doc.note, 'Spotting');
  assert.equal(doc.messages[0].text, 'Is this normal?');
  const json = doc.toJSON();
  assert.equal(json.title, 'Irregular');
  assert.equal(json.messages[0].text, 'Is this normal?');
  assert.equal(json.id, undefined, 'no virtuals added');
  await doc.validate();

  const long = new Model({ note: 'x'.repeat(11) });
  await assert.rejects(long.validate(), /at most 10/);
});

test('plugin json: an object is stored as encrypted JSON, older plain objects still read', async () => {
  const schema = new mongoose.Schema({ answers: { type: mongoose.Schema.Types.Mixed } });
  schema.plugin(encryptFields, { json: ['answers'] });
  const Model = mongoose.model(`EncJsonTest${Date.now()}`, schema);

  const doc = new Model({ answers: { q1: 'yes', q2: 3 } });
  const raw = doc.toObject({ transform: false, getters: false });
  assert.ok(isEncrypted(raw.answers));
  assert.deepEqual(doc.answers, { q1: 'yes', q2: 3 });
  assert.deepEqual(doc.toJSON().answers, { q1: 'yes', q2: 3 });
  await doc.validate();

  assert.deepEqual(openJson({ q1: 'legacy' }), { q1: 'legacy' });
  assert.ok(isEncrypted(sealJson(new Map([['q1', 'yes']]))));
  assert.deepEqual(openJson(sealJson(new Map([['q1', 'yes']]))), { q1: 'yes' });
});
