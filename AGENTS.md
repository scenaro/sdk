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

Default `main`. Keep public API stable; document breaking changes for the docs automation (SCE-560).

## Cursor Cloud specific instructions

- Treat `src/protocol/` as the contract with the runtime — coordinate with voice-agent / API if messages change.
- Prefer unit tests over live LiveKit in CI.
- Do not publish to npm from an agent; only open PRs.
