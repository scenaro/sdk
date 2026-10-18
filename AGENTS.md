# @scenaro/sdk — agent notes

TypeScript SDK: session lifecycle, auth, frontend tools, LiveKit transport. Docs: https://docs.scenaro.io

## Commands

| Action | Command |
|--------|---------|
| Install | `pnpm install` |
| Build | `pnpm run build` |
| Test | `pnpm test` |
| Typecheck | `pnpm run typecheck` |
| Lint | `pnpm run lint` |
| Before PR | `pnpm run typecheck && pnpm test && pnpm run lint` |

## Branches

Day-to-day on `main`. Promote by pushing `main` → `staging` (deploys staging) or to `production` (deploys prod).
PRs are optional while solo — use them for risky / large changes or agent-opened review; otherwise commit on `main` then promote.
Never force-push `main` / `staging` / `production`. Never point agents at production secrets.


## Cursor Cloud specific instructions

- Treat `src/protocol/` as the contract with the runtime — coordinate with voice-agent / API if messages change.
- Prefer unit tests over live LiveKit in CI.
- Do not publish to npm from an agent; only open PRs.
