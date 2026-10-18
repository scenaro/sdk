# Bugbot — sdk

Focus review on:

1. **Public API breakage** without major version / changelog note.
2. **Auth token storage** and refresh races.
3. **Transport** — missed disconnect cleanup, duplicate subscriptions.
4. **XSS / unsafe HTML** if any UI helpers exist.
5. **Types** — `any` leaking into public exports.
