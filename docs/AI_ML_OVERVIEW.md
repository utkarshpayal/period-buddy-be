# AI/ML in The Nura — What Exists, and How It Works

Every AI/ML feature in this product runs **server-side, in this repo**
(`period-buddy-be`). The frontend (`The-Nura-App`, Expo/React Native) has no
on-device ML and no direct calls to any AI provider — it only calls this
backend's `/api/*` endpoints through `lib/api.ts` and renders whatever comes
back. There is exactly **one AI vendor** in the whole system: **Sarvam AI**
(`api.sarvam.ai` for chat/STT/TTS/translate/document-OCR, and a separate
product `apps.sarvam.ai` — informally called "Samvaad" in this codebase — for
the outbound phone-call agent). No OpenAI, Anthropic, Gemini, or any other
provider is used anywhere.

All of it is optional infrastructure: every AI call is gated behind
`isAiConfigured()` (`utils/sarvamClient.js`, true only when `SARVAM_API_KEY`
is set), and every single feature below has a defined, non-AI fallback path
that activates automatically if the key is missing or a call fails. Nothing
in the app hard-depends on AI being up.

```
SARVAM_API_KEY=              # api.sarvam.ai — chat/STT/TTS/translate/doc-extraction
SARVAM_CHAT_MODEL=sarvam-105b
SARVAM_TTS_MODEL=bulbul:v3
SARVAM_TTS_SPEAKER=priya      # female voice; must be valid for the model (see .env.example)
SARVAM_STT_MODEL=saaras:v3

SARVAM_OUTBOUND_API_KEY=     # apps.sarvam.ai — the separate outbound-call product
SARVAM_ORG_ID=
SARVAM_WORKSPACE_ID=
SARVAM_APP_ID=
SARVAM_APP_VERSION=
SARVAM_CONNECTION_ID=
SARVAM_AGENT_PHONE_NUMBER=
```

---

## 1. The core primitives (`utils/sarvamClient.js`)

One file wraps every call to `api.sarvam.ai`. Everything else in this doc is
built on top of these five functions:

| Function | Sarvam capability | Used for |
|---|---|---|
| `createChatCompletion({messages, maxTokens, temperature})` | LLM chat completion (`sarvam-105b`) | Nura AI chat, voice agent turns, document summarize/chat, health-report analysis, partner care suggestions |
| `extractDocumentText({buffer, mimeType})` | Document-intelligence OCR job (upload → poll → download) | Turning an uploaded prescription/lab-report/bill photo or PDF into text |
| `speechToText({audio, ...})` | STT (`saaras:v3`) | Transcribing the user's voice input in the app |
| `textToSpeech({text, ...})` | TTS (`bulbul:v3`) | Speaking the voice agent's replies back to the user |
| `translateText({input, targetLanguageCode})` | Machine translation | Translating blog posts into the user's chosen language |

`SUPPORTED_LANGUAGES` (11 Indic languages + English) is the single list the
whole app offers everywhere a language picker shows up, chosen because it's
the tightest overlap of what chat/STT/TTS/translate all actually support.

This is all **hosted-model inference over HTTP** — no model runs in this
codebase, nothing is trained or fine-tuned here. "ML" in this app means
"calling Sarvam's models with a carefully built prompt/context," plus a
handful of genuinely non-AI statistical/rule-based features described in
section 8.

---

## 2. Nura AI — the companion chat (the main feature)

**Files:** `utils/companionChat.js` (all the logic), `controllers/questionAnswerController.js` / `chatSessionController.js` (the two entry points), consumed by the frontend's `app/(app)/qa.tsx` / `qa-history.tsx`.

This is the most involved AI flow in the app, and it's a **pipeline**, not a
single LLM call:

```
user question
  → urgent-safety regex check          (hasUrgentPattern)
  → topic-scope classifier              (isQueryOnTopic, only if a topic was picked)
  → knowledge-base keyword match        (findBestQuestionAnswer, MongoDB text search)
  → LLM answer, personalized            (createChatCompletion, only if the above found nothing)
  → static keyword fallback             (findFallbackAnswer, only if the LLM call itself fails)
```

**Step by step:**

1. **Urgent-safety regex gate** (`hasUrgentPattern`) — a fixed set of regexes
   for self-harm, heavy bleeding, fainting, fever+pelvic pain, etc. Matches
   here skip *everything* else and return a canned "seek care now" message.
   This is deliberately not left to the LLM to decide.

2. **Topic-scope classification** (`isQueryOnTopic`) — when the user picked a
   topic chip (Periods & Cycle, Symptoms & Pain, Hygiene & Care, Mood & PMS,
   Sex & Intimacy, Nutrition & Wellness), a *second, separate* LLM call —
   whose only job is a strict `YES`/`NO` — decides whether the question
   actually belongs to that topic, using the last 4 turns of conversation as
   context (so "tell me more" or answering a clarifying question counts as
   on-topic). This exists because a single model asked to both "stay on
   topic" and "be helpful" in the same breath will often find some loose
   thread back to the topic and answer anyway. Splitting it into its own
   classifier call makes the restriction something the *code* enforces, not
   something the model merely tries to honor. `temperature: 0`, 5 max tokens.
   A `NO` short-circuits straight to a canned redirect reply — no real answer
   is ever generated for an off-topic question in a scoped chat. "Sex &
   Intimacy" additionally has a server-side age gate (18+) checked before a
   session can even be created.

3. **Knowledge-base match** (`findBestQuestionAnswer`) — a MongoDB regex/text
   search over an admin-curated `QuestionAnswer` collection, scored by term
   overlap (`scoreQuestionAnswer`) and thresholded (`MIN_MATCH_SCORE = 15`).
   **Not AI** — this is a deterministic keyword-matching step that runs
   *before* any LLM call, so a question with a good pre-written answer never
   costs an API call and never varies between askers.

4. **LLM answer, personalized** (`generateCompanionAnswer`'s main branch) —
   only reached if nothing above resolved the question. Builds a system
   prompt (`COMPANION_SYSTEM_PROMPT` — a warm, non-diagnostic sexual/
   reproductive health educator persona, explicitly told what's in-scope and
   to ask at most one clarifying question if the query is genuinely
   ambiguous) plus, for a signed-in asker, a **personalization block**
   (`buildPersonalizationContext`): age, gender, current cycle day/phase
   (via `computeCyclePredictions`), tracking goal, and recent symptoms —
   pulled from their own logged data, never disclosed back to them, used
   only to tailor tone/relevance (e.g. a cramps question lands differently
   for someone currently on day 2 of their period). Anonymous questions get
   no personalization, just a solid general answer. `maxTokens: 700`.

5. **Local fallback** (`findFallbackAnswer`) — if the LLM call itself throws
   (Sarvam down, rate-limited, etc.), a small hardcoded keyword→answer table
   is checked before finally giving up on a truly generic reply
   (`DEFAULT_COMPANION_REPLY`).

**Session persistence:** `chatSessionController.js`'s `/api/questions/sessions*`
endpoints (login-gated) run the exact same `generateCompanionAnswer` pipeline
per turn, with the session's prior messages fed in as `history` for
conversational continuity, and each session optionally pinned to one topic
for its whole lifetime. The stateless `/api/questions/ask` endpoint (anonymous-
friendly) runs the same pipeline with `topicId: null`, so it's always
unscoped.

**Every topic** also has a structured "intake" form (`CHAT_TOPICS[topic].intake`
in `companionChat.js`, mirrored client-side in `lib/chatTopics.ts`) — a couple
of short questions (choice chips or free text) asked before the chat opens,
whose answers get folded into one opening message. This is a UX layer on
top of the same pipeline, not a separate AI call.

---

## 3. Voice Agent — in-app conversational logging

**File:** `controllers/voiceAgentController.js`, endpoint `POST /api/voice-agent/converse`. Frontend: `app/(app)/qa.tsx` / `document-chat.tsx` in voice mode (`VoiceModeOverlay`, `useVoiceInput`).

This is a **single LLM call per conversation turn**, but the interesting part
is that the model isn't just asked to chat — it's asked to act as a tiny
**agent with a structured, JSON-only output contract**, so the app can safely
turn its reply into a real database write:

```json
{"type": "answer", "text": "..."}
{"type": "action_proposal", "action": "log_cycle_entry", "payload": {...partial fields...}, "followUpQuestion": "..."}
{"type": "action_confirm", "action": "log_cycle_entry", "payload": {...complete fields...}, "confirmationText": "..."}
```

The system prompt tells the model: if the user is just asking a question,
reply `answer`; if they want to log something (flow, symptoms, mood, sleep,
water, weight, temperature, stress, medication, digestion, skin, discharge,
exercise, intimacy, a note) but the model doesn't yet have enough
information, reply `action_proposal` with whatever fields it *does* have plus
one follow-up question; once it has enough and the user has effectively
confirmed, reply `action_confirm`. The server (`parseAgentReply`) parses this
JSON (tolerating an accidental code-fence wrap), and when the *client* later
POSTs back `confirmed: true` for a proposed action, the server executes it
directly — via the same `upsertCycleLog` the REST tracker endpoint and the
outbound-call webhook use — **without another AI round-trip**. Off-topic
requests are handled the same way as the chat companion: the model is told to
reply `answer` with a brief redirect rather than actually answering.

This is a hand-rolled, prompt-level version of "function calling" — Sarvam's
chat API doesn't expose native tool-calling here, so the contract is enforced
by the system prompt + a parser, not by the API itself.

---

## 4. Document Vault — OCR, summarize, and chat over your own documents

**Files:** `controllers/documentController.js`, `utils/sarvamClient.js#extractDocumentText`. Frontend: `app/(app)/documents.tsx`, `document-chat.tsx`.

Three separate AI-touching steps, each independently gated:

1. **Extraction (OCR)** — on upload, the file (image or PDF) goes through
   Sarvam's **document-intelligence job pipeline** (`extractDocumentText`):
   create a job → get a presigned upload URL → PUT the file → start the job →
   poll every 2s up to 45s → download the output (a zip containing markdown
   text) → unzip and concatenate. This is a genuinely async, multi-step job,
   not a single request/response call — which is why it now runs
   **fire-and-forget** after the upload response is sent (the `Document` is
   created with `extractionStatus: 'pending'` immediately; a
   `document_extraction_update` event broadcasts over the uploader's
   WebSocket room when it finishes). Below `MIN_MEANINGFUL_CHARS` (20
   characters) of extracted text, the status is `'limited'` rather than
   `'done'` — still saved, but flagged so the UI/AI prompts downstream are
   honest about how little there is to work with.

2. **Summarize** (`summarizeDocuments`) — an LLM call over all documents in a
   date range (`buildDocumentContext` truncates each to 4000 chars, capped at
   20 documents total), prompted to group by date, call out abnormal lab
   values/medication changes/follow-ups, never invent facts not in the text,
   and end with a "not medical advice" note.

3. **Chat** (`sendChatMessage`) — a persisted, multi-turn Q&A over the same
   document context plus the last 20 messages of prior chat history, prompted
   to answer *only* what was asked (no padding, no default disclaimer unless
   actually relevant) and to say plainly when the answer isn't in the
   documents.

Summarize and chat (and the health report below) also read **prescriptions
from Nura's doctors**, because they're saved as documents:
`utils/prescriptionDocumentStore.js` writes each one as a private PDF
`Document` (`source: 'consultation'`, the prescription text as
`extractedText`) when the doctor saves it, and `syncPrescriptionDocuments`
catches up any missing ones before each of these runs. No OCR is needed.

Neither summarize nor chat happens without at least one document (upload or
doctor's prescription) — there's a canned "no documents yet" reply if there
are none, no wasted AI call.

---

## 5. Outbound Check-in Calls — a real phone call from a hosted voice agent

**Files:** `utils/samvaadClient.js`, `controllers/voiceAgentController.js` (`runCheckinCallForUser`, the `/checkin-call/webhook` handler), `utils/checkinCallScheduler.js`. Frontend: `app/(app)/checkin-call.tsx`.

This is different in kind from everything above: it's **not** a prompt this
codebase writes per-call. It calls Sarvam's own **Instant Outbound** product
(`apps.sarvam.ai`, a separate host/auth from the rest of Sarvam, informally
"Samvaad" in comments here) — a fully hosted conversational voice agent
(`SARVAM_APP_ID` identifies which pre-built agent to run) that places a real
phone call to the user's number, has the actual voice conversation, and posts
a webhook back to this API when the call ends. This backend's job is just:

- **Trigger** the call (`startCheckinCall`) with the app/connection IDs and
  the user's phone number (normalized to E.164), either on-demand
  ("call me now") or on a recurring schedule.
- **Authenticate the webhook** it gets back: a signed, short-TTL JWT
  (`webhook_config.metadata.callToken`) correlates the completed call to a
  `userId`, taken only from the token's decoded claim — never trusted
  verbatim from the payload.
- **Apply whatever the agent extracted** (`final_agent_variables` — flow,
  mood, symptoms, etc., if the user talked about logging something) through
  the same `upsertCycleLog` as every other entry point, with `dateKey`
  deliberately always forced to *today* server-side (never taken from the
  agent's own variables — a hallucinated/misheard date from voice
  recognition should never silently overwrite an unrelated day's log).

Recurring calls are driven by a scheduler tick (`utils/checkinCallScheduler.js`
/ `inProcessScheduler.js`) that's pure date/time logic, no AI involved — the
AI is entirely inside Sarvam's hosted agent during the call itself.

---

## 6. Speech — transcription and voice replies

**File:** `controllers/speechController.js`, thin wrappers over `speechToText`/`textToSpeech`. Frontend: `hooks/useVoiceInput.ts`, `components/VoiceOrb.tsx`.

`POST /api/speech/transcribe` (STT, `saaras:v3`) turns the user's recorded
voice into text, which then feeds into either the Nura AI chat or the voice
agent's `/converse` endpoint above. `POST /api/speech/tts` (TTS, `bulbul:v3`)
turns a reply back into audio for the "voice mode" overlay to play. The voice
is always female: `resolveTtsSpeaker` in `sarvamClient.js` accepts a
requested `speaker` (or `SARVAM_TTS_SPEAKER`) only if it's a female voice for
the configured model, else uses the model's default (`priya` on `bulbul:v3`,
`anushka` on `bulbul:v2`). The outbound check-in call agent's voice is set in
the Sarvam dashboard, not in code; keep it female too. Neither
endpoint does any reasoning itself — they're the ears/mouth around the chat
and voice-agent brains described above.

---

## 7. Smaller AI touches

- **Blog translation** (`controllers/blogController.js`) — `translateText`
  machine-translates a blog's title + body (chunked to `TRANSLATE_MAX_CHARS =
  2000` per call) into the reader's chosen language on demand. Pure
  translation, no summarization or reasoning.

- **Health Report AI analysis** (`controllers/reportController.js`) — when
  generating the downloadable/viewable health report (`getHealthReport`), if
  there's anything to analyze (uploaded documents, prescriptions from Nura's
  doctors, saved as documents) and/or logged cycle data),
  one `createChatCompletion` call summarizes both into a plain-language
  analysis (abnormal values, medication changes, symptom patterns, follow-up
  actions), always ending with a "not medical advice" note. This is a bonus
  field on the report, not a hard requirement — a failed call just omits
  `analysis` and the rest of the report (stats, charts, trends) still
  generates normally.

- **Partner "care suggestions"** (`utils/careSuggestionsAi.js`) — the
  partner-view overview screen's tips + dos/don'ts. A rule-based version
  (`caringEngine.js`) always runs first as the floor; if AI is configured and
  there's actually something to analyze (cycle phase, recent logs, and/or
  report excerpts — each gated by the *owner's own sharing permissions*), one
  LLM call is asked to return **strict JSON** (`{"suggestions":[...],
  "dos":[...], "donts":[...]}`) analyzing that data for how the partner can
  support them right now. Any parse failure, empty result, or thrown error
  falls straight back to the rule-based suggestions — the AI layer can only
  ever improve on the floor, never break the feature.

---

## 8. What's *not* AI (worth being explicit about)

Several features in the app sound ML-flavored but are deliberately plain
statistics/rules — no model call, no training data, fully deterministic and
free to run as often as needed:

- **Cycle predictions** (`utils/cycle.js#computeCyclePredictions`) — next
  period/ovulation/fertile-window dates, derived from the user's own logged
  period-start episodes via robust statistics (median/MAD-based spread,
  variability-adjusted confidence bands), anchored to the most recent
  *actual* logged period rather than a static configured date. This is the
  single source of truth for "what phase/day is this," used by the tracker,
  insights, partner view, and both AI-personalization contexts above (so the
  LLM prompts get the same numbers the UI shows).
- **Symptom predictions** (`cycleController.js#getSymptomPredictions`) — "per-
  symptom likelihood by cycle phase," which is literally a frequency count of
  (symptom, phase) occurrences across the user's own past logged cycles,
  bucketed via the same phase math above. The endpoint's own comment says it
  outright: *"No AI/ML — purely a frequency count."*
- **Symptom Checker** (`controllers/screeningController.js`) — the PCOS/
  endometriosis/thyroid/fibroid screener is a deterministic weighted-sum
  scoring system over admin-authored questions, not a trained classifier and
  not an LLM call.
- **Daily Insights** (`controllers/insightController.js`) — hormone/mood/
  energy/skin insight text and exercise/nutrition/sleep suggestions are
  rule-based template lookups keyed off cycle phase and recent logs, not
  generated by a model.
- **Reward/gamification, government-scheme eligibility, everything else** —
  plain application logic.

If you're auditing "what calls an AI provider," the answer is exactly the six
sections above (2–7) — everything else in the app, including things that
sound predictive, is ordinary code.

---

## Quick reference: files that import `sarvamClient.js`

```
utils/companionChat.js         → Nura AI chat pipeline           (§2)
controllers/voiceAgentController.js → converse + check-in call webhook (§3, §5)
controllers/documentController.js   → OCR, summarize, chat        (§4)
utils/samvaadClient.js         → outbound call trigger (separate host/product) (§5)
controllers/speechController.js     → STT / TTS                   (§6)
controllers/blogController.js       → translation                (§7)
controllers/reportController.js     → health report analysis      (§7)
utils/careSuggestionsAi.js     → partner care suggestions          (§7)
```
