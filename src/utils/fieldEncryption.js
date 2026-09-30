import crypto from 'crypto';
import logger from './logger.js';

/**
 * Field-level encryption for free-text health data (AI chats, messages,
 * document text, notes). Values are encrypted with AES-256-GCM before they
 * reach MongoDB, so a database dump or backup shows only ciphertext.
 *
 * Keys: DATA_ENCRYPTION_KEYS = "<id>:<base64 32 bytes>[,<id>:<key>…]". The
 * first key encrypts; every listed key can decrypt, so rotating is: put a new
 * key first, deploy, run `node src/scripts/encryptExistingData.js`, and drop
 * the old key once that's done. Generate a key with
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * and keep it in the secrets manager, never in the repo.
 *
 * Stored form: "enc1:<keyId>:<iv>:<tag>:<ciphertext>" (base64url parts).
 * Anything without the prefix is legacy plain text and is returned as is, so
 * deploying this never breaks existing rows.
 *
 * What's encrypted can't be searched, sorted or aggregated in the database;
 * only encrypt free text that is only ever read back whole.
 */

const PREFIX = 'enc1:';
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;

/** "k1:base64,k0:base64" → { active, keys: Map<id, Buffer> }; throws on a malformed entry. */
export const parseKeyring = (raw) => {
  const keys = new Map();
  let active = null;
  for (const entry of String(raw || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const [id, b64] = entry.split(':');
    const key = Buffer.from(b64 || '', 'base64');
    if (!KEY_ID.test(id || '') || key.length !== 32) {
      throw new Error(
        `DATA_ENCRYPTION_KEYS: "${id || entry.slice(0, 8)}" must be <id>:<base64 of 32 bytes>`,
      );
    }
    if (keys.has(id)) throw new Error(`DATA_ENCRYPTION_KEYS: key id "${id}" is listed twice`);
    keys.set(id, key);
    active ??= id;
  }
  return { active, keys };
};

let keyring = parseKeyring(process.env.DATA_ENCRYPTION_KEYS);

// Like JWT_SECRET (utils/jwt.js): refuse to run production without keys,
// since the only alternative is silently storing health data in plain text.
if (!keyring.active) {
  logger.error('data_encryption_keys_missing', { action: 'data_encryption_keys_missing' });
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATA_ENCRYPTION_KEYS must be set in production. Refusing to start.');
  }
}

/** Swap the keyring (tests, key rotation scripts). */
export const setKeyring = (raw) => {
  keyring = parseKeyring(raw);
};

export const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);

/** Encrypt a string. Empty, non-string or already-encrypted values pass through; so does everything without keys (dev only). */
export const encryptValue = (v) => {
  if (typeof v !== 'string' || v === '' || isEncrypted(v) || !keyring.active) return v;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyring.keys.get(keyring.active), iv);
  const ct = Buffer.concat([cipher.update(v, 'utf8'), cipher.final()]);
  return `${PREFIX}${keyring.active}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
};

/**
 * Decrypt a value from encryptValue. Plain text passes through. A value that
 * can't be decrypted (unknown key, tampered) throws: returning ciphertext or
 * an empty string would hide data loss.
 */
export const decryptValue = (v) => {
  if (!isEncrypted(v)) return v;
  const [id, iv, tag, ct] = v.slice(PREFIX.length).split(':');
  const key = keyring.keys.get(id);
  if (!key) throw new Error(`Encrypted with key "${id}", which isn't in DATA_ENCRYPTION_KEYS`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
};

/** The key id a stored value was encrypted with (null for plain text). */
export const keyIdOf = (v) => (isEncrypted(v) ? v.slice(PREFIX.length).split(':')[0] : null);
export const activeKeyId = () => keyring.active;

/* ------------------------------ Mongoose plugin ----------------------------- */

/** Apply `fn` to the value at `path` ("text", "messages.text") in a plain object, in place. */
export const mapPath = (obj, path, fn) => {
  if (!obj || typeof obj !== 'object') return;
  const [head, ...rest] = path.split('.');
  if (!(head in obj)) return;
  if (rest.length === 0) {
    obj[head] = Array.isArray(obj[head]) ? obj[head].map(fn) : fn(obj[head]);
    return;
  }
  const child = obj[head];
  if (Array.isArray(child)) child.forEach((c) => mapPath(c, rest.join('.'), fn));
  else mapPath(child, rest.join('.'), fn);
};

/** The SchemaType for "a.b", looking inside document arrays / subdocuments. */
const schemaTypeOf = (schema, path) => {
  const direct = schema.path(path);
  if (direct) return direct;
  const [head, ...rest] = path.split('.');
  const parent = schema.path(head);
  return parent?.schema ? schemaTypeOf(parent.schema, rest.join('.')) : null;
};

/**
 * Structured values (an object of answers) are stored as encrypted JSON.
 * Rows from before that are still plain objects and are returned as is.
 */
export const sealJson = (v) => {
  if (v == null || typeof v !== 'object') return v;
  const plain = v instanceof Map ? Object.fromEntries(v) : v;
  return encryptValue(JSON.stringify(plain));
};
export const openJson = (v) => (typeof v === 'string' ? JSON.parse(decryptValue(v)) : v);

const decryptEach = (v) => (Array.isArray(v) ? v.map(decryptValue) : decryptValue(v));
const encryptEach = (v) => (Array.isArray(v) ? v.map(encryptValue) : encryptValue(v));

/**
 * Mongoose plugin: `schema.plugin(encryptFields, { fields: ['text', 'messages.text'] })`.
 *
 * - Assigning a field encrypts it (a setter, so `save`, `create`, `$set` and
 *   `$push` in updates are all covered).
 * - Reading it on a document decrypts it (a getter), and so do toJSON /
 *   toObject and `.lean()` queries.
 * - `maxlength` is checked against the plain text, not the longer ciphertext.
 * - `json: ['answers']` stores a whole object as one encrypted JSON string
 *   (declare that path as Mixed).
 */
export const encryptFields = (schema, { fields = [], json = [] }) => {
  for (const path of json) {
    const type = schema.path(path);
    if (!type) throw new Error(`encryptFields: no path "${path}"`);
    type.setters.unshift(sealJson);
    type.get(openJson);
  }

  for (const path of fields) {
    const type = schemaTypeOf(schema, path);
    if (!type) throw new Error(`encryptFields: no path "${path}"`);
    const isArray = type.$isMongooseArray || Array.isArray(type.options?.type);
    const inner = isArray ? type.caster : type;

    const max = inner.options?.maxlength;
    if (max) {
      const limit = Array.isArray(max) ? max[0] : max;
      inner.validators = inner.validators.filter((v) => v.type !== 'maxlength');
      inner.validate({
        validator: (v) => v == null || String(decryptValue(v)).length <= limit,
        message: `{PATH} must be at most ${limit} characters`,
        type: 'maxlength',
      });
    }
    // Mongoose runs setters last-added first, so put encryption at the
    // front of the list: it then runs after trim / lowercase.
    if (isArray) {
      type.setters.unshift(encryptEach);
      type.get(decryptEach);
    } else {
      type.setters.unshift(encryptValue);
      type.get(decryptValue);
    }
  }

  // toJSON / toObject: decrypt without turning on every getter and virtual.
  for (const method of ['toJSON', 'toObject']) {
    const options = schema.get(method) || {};
    const previous = options.transform;
    schema.set(method, {
      ...options,
      transform(doc, ret, opts) {
        for (const path of fields) mapPath(ret, path, decryptEach);
        for (const path of json) mapPath(ret, path, openJson);
        return typeof previous === 'function' ? (previous(doc, ret, opts) ?? ret) : ret;
      },
    });
  }

  // .lean() results skip getters: decrypt them here.
  const decryptLean = function (res) {
    if (!res || !this.mongooseOptions?.().lean) return;
    for (const row of Array.isArray(res) ? res : [res]) {
      for (const path of fields) mapPath(row, path, decryptEach);
      for (const path of json) mapPath(row, path, openJson);
    }
  };
  schema.post(
    ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace'],
    decryptLean,
  );
};
