import JSZip from 'jszip';
import logger from './logger.js';

const SARVAM_API_BASE = 'https://api.sarvam.ai';
const CHAT_MODEL = process.env.SARVAM_CHAT_MODEL || 'sarvam-105b';
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || 'bulbul:v3';
const STT_MODEL = process.env.SARVAM_STT_MODEL || 'saaras:v3';

// The 11 Indic languages Sarvam's text-to-speech (bulbul) supports — the
// tightest of chat/STT/TTS/translate's language sets, so it doubles as the
// single list the frontend offers everywhere a language picker is needed.
export const SUPPORTED_LANGUAGES = [
  { code: 'en-IN', label: 'English' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'od-IN', label: 'Odia' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
];

const LANGUAGE_LABELS = Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l.code, l.label]));

// Every spoken reply uses a female voice. Speaker names are per model
// (bulbul:v2's "anushka" is rejected by bulbul:v3 and vice versa), so the
// allowlist and default follow SARVAM_TTS_MODEL. SARVAM_TTS_SPEAKER
// overrides the default but must be a female voice valid for the model.
const FEMALE_TTS_SPEAKERS = {
  'bulbul:v2': ['anushka', 'manisha', 'vidya', 'arya'],
  'bulbul:v3': [
    'priya',
    'ritu',
    'neha',
    'pooja',
    'simran',
    'kavya',
    'ishita',
    'shreya',
    'roopa',
    'tanya',
    'shruti',
    'suhani',
    'kavitha',
    'rupali',
  ],
};

/** Picks the TTS speaker: the requested one if it's a female voice for the
 * model, else SARVAM_TTS_SPEAKER (same check), else the model's first
 * female voice. Never returns a male voice. */
export const resolveTtsSpeaker = (
  requested,
  { model = TTS_MODEL, envSpeaker = process.env.SARVAM_TTS_SPEAKER } = {},
) => {
  const allowed = FEMALE_TTS_SPEAKERS[model] || FEMALE_TTS_SPEAKERS['bulbul:v3'];
  for (const candidate of [requested, envSpeaker]) {
    const name = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
    if (name && allowed.includes(name)) return name;
  }
  return allowed[0];
};

export const isAiConfigured = () => Boolean(process.env.SARVAM_API_KEY);

const authHeaders = () => {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error('AI is not configured on the server (missing SARVAM_API_KEY)');
  }
  return { 'api-subscription-key': apiKey };
};

async function readJsonOrThrow(response, action) {
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // Non-JSON body (rare — e.g. an upstream gateway error page); fall through
    // to the generic message below using the raw text instead.
  }
  if (!response.ok) {
    const message =
      body?.error?.message || body?.message || raw || `Sarvam request failed (${response.status})`;
    logger.error(action, { action, status: response.status, error: message });
    throw new Error(message);
  }
  return body;
}

export const createChatCompletion = async ({ messages, maxTokens = 2000, temperature = 0.4 }) => {
  const response = await fetch(`${SARVAM_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      // sarvam-30b/105b default to a "thinking" mode that spends completion
      // tokens on a hidden reasoning_content field before (or instead of, if
      // max_tokens runs out first) the actual reply — disabling it here is
      // what keeps chat replies fast and within maxTokens.
      reasoning_effort: null,
    }),
  });

  const data = await readJsonOrThrow(response, 'sarvam_chat_completion_failed');
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('AI returned an empty response');
  }
  return text;
};

/** Converts written text to speech. Returns a single base64-encoded audio
 * clip (wav by default) plus the codec, ready for the client to play or
 * save with a matching file extension. */
export const textToSpeech = async ({
  text,
  targetLanguageCode = 'en-IN',
  speaker,
  pace = 1.0,
  outputAudioCodec = 'mp3',
}) => {
  if (!text || !text.trim()) {
    throw new Error('Text is required for speech synthesis');
  }

  // bulbul:v3 caps input at 2500 chars per request; longer text (a full
  // document summary, say) is silently truncated by the API otherwise.
  const trimmedText = text.trim().slice(0, 2500);

  const response = await fetch(`${SARVAM_API_BASE}/text-to-speech`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: trimmedText,
      target_language_code: targetLanguageCode,
      model: TTS_MODEL,
      speaker: resolveTtsSpeaker(speaker),
      pace,
      output_audio_codec: outputAudioCodec,
    }),
  });

  const data = await readJsonOrThrow(response, 'sarvam_tts_failed');
  const audioBase64 = data?.audios?.[0];
  if (!audioBase64) {
    throw new Error('AI returned no audio');
  }
  return { audioBase64, audioCodec: outputAudioCodec };
};

/** Transcribes spoken audio to text, optionally translating it to English
 * (mode: 'translate') instead of transcribing in the spoken language
 * (mode: 'transcribe', the default). */
/**
 * Sarvam rejects non-standard labels like "audio/m4a" (a 500 for the app).
 * Map the common aliases recorders and browsers send to real media types,
 * and drop parameters such as ";codecs=opus".
 */
export const normalizeAudioMime = (mimeType) => {
  const base = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (['audio/m4a', 'audio/x-m4a', 'video/mp4', 'audio/aac-mp4'].includes(base)) return 'audio/mp4';
  if (base === 'audio/mp3' || base === 'audio/x-mp3') return 'audio/mpeg';
  if (base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav';
  return base || 'application/octet-stream';
};

export const speechToText = async ({
  buffer,
  mimeType,
  filename = 'audio.m4a',
  languageCode,
  mode = 'transcribe',
}) => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: normalizeAudioMime(mimeType) }), filename);
  form.append('model', STT_MODEL);
  form.append('mode', mode);
  if (languageCode) form.append('language_code', languageCode);

  const response = await fetch(`${SARVAM_API_BASE}/speech-to-text`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  const data = await readJsonOrThrow(response, 'sarvam_stt_failed');
  return {
    transcript: data?.transcript || '',
    languageCode: data?.language_code || null,
    languageProbability: data?.language_probability ?? null,
  };
};

// sarvam-translate:v1 (vs. the older mayura:v1) allows 2000 chars per call
// instead of 1000, so long-form content needs fewer chunks.
const TRANSLATE_MODEL = process.env.SARVAM_TRANSLATE_MODEL || 'sarvam-translate:v1';
export const TRANSLATE_MAX_CHARS = 2000;

export const translateText = async ({
  input,
  sourceLanguageCode = 'en-IN',
  targetLanguageCode,
}) => {
  const response = await fetch(`${SARVAM_API_BASE}/translate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      source_language_code: sourceLanguageCode,
      target_language_code: targetLanguageCode,
      model: TRANSLATE_MODEL,
    }),
  });

  const data = await readJsonOrThrow(response, 'sarvam_translate_failed');
  return {
    translatedText: data?.translated_text || '',
    sourceLanguageCode: data?.source_language_code || null,
  };
};

// Below this, extraction is treated as too sparse to be useful (e.g. a blank
// page) — still saved, but flagged so the AI prompts and UI can be honest
// about what they actually have to work with.
const MIN_MEANINGFUL_CHARS = 20;

const JOB_POLL_INTERVAL_MS = 2000;
const JOB_POLL_TIMEOUT_MS = 45000;

const sarvamJsonRequest = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${SARVAM_API_BASE}${path}`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readJsonOrThrow(response, 'sarvam_doc_digitization_failed');
};

/** Wraps a single image in an in-memory zip — the document-intelligence job
 * API only accepts .pdf or .zip uploads, not bare image files, and most
 * documents in this app are photographed (not scanned to PDF). */
async function zipSingleFile(buffer, filename) {
  const zip = new JSZip();
  zip.file(filename, buffer);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function pollJobUntilDone(jobId) {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await sarvamJsonRequest(`/doc-digitization/job/v1/${jobId}/status`);
    if (['Completed', 'PartiallyCompleted', 'Failed'].includes(status.job_state)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
  throw new Error('Document processing timed out');
}

/** Sends a document (image or PDF) through Sarvam's document-intelligence
 * job pipeline and returns the transcribed/parsed text. Vision-model OCR
 * (as Gemini did inline) isn't part of Sarvam's product, so this is a
 * multi-step flow: create a job, upload the file to a presigned URL, start
 * it, poll until done, then fetch the output file's text. */
export const extractDocumentText = async ({ buffer, mimeType, languageCode = 'en-IN' }) => {
  if (!isAiConfigured()) {
    logger.error('document_extraction_no_ai', { action: 'document_extraction_no_ai' });
    return { text: '', status: 'failed' };
  }

  try {
    const isPdf = mimeType === 'application/pdf';
    const filename = isPdf ? 'document.pdf' : 'document.zip';
    const fileBuffer = isPdf ? buffer : await zipSingleFile(buffer, 'page-1.jpg');

    const { job_id: jobId } = await sarvamJsonRequest('/doc-digitization/job/v1', {
      method: 'POST',
      body: { job_parameters: { language: languageCode, output_format: 'md' } },
    });

    const uploadInfo = await sarvamJsonRequest('/doc-digitization/job/v1/upload-files', {
      method: 'POST',
      body: { job_id: jobId, files: [filename] },
    });
    const uploadUrl = uploadInfo?.upload_urls?.[filename]?.file_url;
    if (!uploadUrl) {
      throw new Error('Sarvam did not return an upload URL for the document');
    }

    // Sarvam's doc-digitization storage backend is Azure Blob Storage, which
    // requires this header on every PUT to a SAS upload URL (other backends
    // ignore it).
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileBuffer,
      headers: { 'x-ms-blob-type': 'BlockBlob' },
    });
    if (!putResponse.ok) {
      throw new Error(`Document upload failed (${putResponse.status})`);
    }

    await sarvamJsonRequest(`/doc-digitization/job/v1/${jobId}/start`, { method: 'POST' });

    const finalStatus = await pollJobUntilDone(jobId);
    if (finalStatus.job_state === 'Failed') {
      throw new Error('Sarvam failed to process the document');
    }

    const downloadInfo = await sarvamJsonRequest(
      `/doc-digitization/job/v1/${jobId}/download-files`,
      { method: 'POST' },
    );
    const downloadUrls = Object.values(downloadInfo?.download_urls || {});
    if (!downloadUrls.length) {
      throw new Error('Sarvam returned no output files for the document');
    }

    // Each entry is itself a zip (e.g. "document.zip") containing the
    // requested output_format file(s) — here "document.md" — alongside a
    // metadata/ folder of per-page layout JSON we don't need.
    const outputTexts = await Promise.all(
      downloadUrls.map(async (entry) => {
        const fileResponse = await fetch(entry.file_url);
        if (!fileResponse.ok) return '';
        const buffer = Buffer.from(await fileResponse.arrayBuffer());
        const outputZip = await JSZip.loadAsync(buffer);
        const mdFiles = Object.keys(outputZip.files).filter(
          (name) => !outputZip.files[name].dir && name.endsWith('.md'),
        );
        const contents = await Promise.all(
          mdFiles.map((name) => outputZip.files[name].async('string')),
        );
        return contents.join('\n\n');
      }),
    );
    const text = outputTexts.join('\n\n').trim();

    return { text, status: text.length >= MIN_MEANINGFUL_CHARS ? 'done' : 'limited' };
  } catch (error) {
    logger.error('document_extraction_failed', {
      action: 'document_extraction_failed',
      error: error.message,
      mimeType,
    });
    return { text: '', status: 'failed' };
  }
};

export const getLanguageLabel = (code) => LANGUAGE_LABELS[code] || code;
