# Changelog

## 0.4.3

- Expose `setSessionControl` on `useScenaroSession` (discrete/dictation/manual audio, exchange mode, mode-switch handoff).
- `suppressRecap` on `start()` options (wire `suppress_recap`).
- Collection item context bridge: `useCollectionItemContext` + agent envelopes for guardrail / Jev item sync.
- Trace role and session-control protocol alignments used by Uma and staging experiences.

## 0.4.2

- Session control helpers on the headless session (`setSessionControl`).
- Public resource helpers refinements.

## 0.4.1

- Patch release on top of 0.4.0 (npm latest tag through 2026-09).

## 0.4.0

- Public API resource helpers (collections, buckets, memories, conversations, advanced search).
- Application-scoped JWT auth and structured API errors.
- Session event / state / control helpers.
- **Session context via `metadata`**: forwarded to `POST /v1/public/session` as
  LiveKit `session_context`.
- **Backend-minted session via `connection`**: `start({ connection: { livekitUrl,
  livekitToken } })` skips public identify/session — for apps whose backend called
  `/applications/:id/token` (+ optional `/public/session`) with an API key.
