// Single source of truth for "which HTTP calls does this SubscriptionFeature
// key gate." Read by middleware/subscriptionMiddleware.js#globalFeatureGate,
// mounted once in index.js ahead of every domain router — so a route never
// needs its own inline `requireFeatureAccess('key')` call, and toggling a
// key premium in the admin Features tab enforces it here immediately, with
// zero other code changes.
//
// To gate a brand-new action: add one entry below (and, if the key doesn't
// exist yet, a matching row in utils/subscriptionSeedData.js so it shows up
// in the admin Features tab to price/toggle) — that's the whole change.
// Nothing else in the codebase needs touching.
//
// `path` is matched against `req.path` (the URL after the domain, before
// the query string) with a RegExp rather than a route-pattern library, to
// keep this file dependency-free and each entry readable/auditable at a
// glance. `:id`-shaped segments are written as `[^/]+`.
export const FEATURE_ROUTES = [
  // Nura AI Assistant — persisted chat sessions (the free anonymous /ask
  // endpoint is deliberately never listed here).
  { key: 'ai_assistant', method: 'POST', path: /^\/api\/questions\/sessions$/ },
  { key: 'ai_assistant', method: 'POST', path: /^\/api\/questions\/sessions\/[^/]+\/messages$/ },

  // Medical document vault — uploading, chatting about, and summarizing
  // documents. `summarize` was missing an entry entirely (a permanent free
  // bypass for anyone with an existing uploaded document), unlike upload/chat.
  { key: 'document_chat', method: 'POST', path: /^\/api\/documents$/ },
  { key: 'document_chat', method: 'POST', path: /^\/api\/documents\/chat$/ },
  { key: 'document_chat', method: 'POST', path: /^\/api\/documents\/summarize$/ },

  // PCOS/endometriosis/fibroid/thyroid symptom checker.
  { key: 'symptom_checker', method: 'POST', path: /^\/api\/screening\/assess$/ },

  // Outbound "Buddy" voice check-in calls, one-off or scheduled.
  { key: 'voice_checkin_calls', method: 'POST', path: /^\/api\/voice-agent\/checkin-call$/ },
  {
    key: 'voice_checkin_calls',
    method: 'PUT',
    path: /^\/api\/voice-agent\/checkin-call\/schedule$/,
  },

  // Saving a government scheme application.
  { key: 'government_scheme_applications', method: 'POST', path: /^\/api\/scheme-applications$/ },

  // Creating a community post (browsing/commenting/liking stay free).
  { key: 'community_posting', method: 'POST', path: /^\/api\/community$/ },

  // Connecting a partner — generating the invite code (the partner's own
  // read-only shared view, once connected, stays free).
  { key: 'partner_connect', method: 'POST', path: /^\/api\/partner\/invite$/ },

  // "Symptom Predictions" — likelihood-by-cycle-phase derived from the
  // user's own logged history. Distinct from `symptom_checker` above
  // (that's the PCOS/etc. questionnaire; this is the predictive insight).
  { key: 'symptom_predictions', method: 'GET', path: /^\/api\/cycle\/symptom-predictions$/ },

  // Period Buddy — nominating a discovered candidate into an active match
  // (an active buddy's ongoing chat/call stays free, same shape as
  // partner_connect above). Note: this is buddyRoutes.js's
  // POST /api/buddies/:matchId/nominate — *not* the separate, currently
  // unused-by-the-app nominationRoutes.js (/api/nominations, a by-email
  // invite flow with no client-side caller yet); double-check which one a
  // screen actually calls before reusing this pattern for either.
  { key: 'period_buddy', method: 'POST', path: /^\/api\/buddies\/[^/]+\/nominate$/ },
];
