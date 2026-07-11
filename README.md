# @scenaro/sdk

Voice AI sessions for the web — session lifecycle, auth, frontend tools, and feature runtime,
built on a realtime transport (LiveKit today).

**Full documentation:** https://docs.scenaro.io

## Install

```bash
pnpm add @scenaro/sdk
# peer deps (React apps)
pnpm add react react-dom livekit-client @livekit/components-react
```

## Quick start (React)

```tsx
import { ScenaroProvider, useScenaroSession } from '@scenaro/sdk/react';

function App() {
  return (
    <ScenaroProvider apiUrl="https://api.scenaro.io">
      <VoiceButton />
    </ScenaroProvider>
  );
}

function VoiceButton() {
  const { status, start, end } = useScenaroSession({
    scenario: 'your-publication-uuid',
    tools: {
      search_products: async ({ query }) => searchCatalog(query),
    },
  });

  return status === 'connected'
    ? <button onClick={end}>End session</button>
    : <button onClick={() => start()}>Talk to the assistant</button>;
}
```

The hook handles identification, session start, transport connection, config handshake, and
tool RPC. See the [quickstart](https://docs.scenaro.io/introduction/quickstart).

## Without React

```ts
import { ScenaroSession } from '@scenaro/sdk';

const session = new ScenaroSession({ apiUrl: 'https://api.scenaro.io' });
session.on('message', (message) => render(message));
await session.start({ scenario: 'your-publication-uuid' });
```

## Sub-exports

| Import | Purpose |
|--------|---------|
| `@scenaro/sdk` | `ScenaroSession` (headless), client, protocol — framework-agnostic |
| `@scenaro/sdk/react` | `ScenaroProvider`, `useScenaroSession`, `FeatureProvider` |
| `@scenaro/sdk/client` | `createScenaroClient`, JWT, session storage |
| `@scenaro/sdk/protocol` | Data-channel topics, message types, RPC contracts |

## Advanced: Transport extensions

`@scenaro/sdk` abstracts its realtime transport behind an internal `Transport` interface —
implemented with LiveKit today. It builds on LiveKit and doesn't hide it: `useScenaroSession`
exposes `room`, and `ScenaroProvider` injects `RoomContext` — so `@livekit/components-react`
hooks and components work directly next to the Scenaro contract. See
[Advanced: Transport extensions](https://docs.scenaro.io/guides/advanced-transport-integration).

## Build & test

```bash
pnpm --filter @scenaro/sdk build
pnpm --filter @scenaro/sdk test
pnpm --filter @scenaro/sdk lint
pnpm --filter @scenaro/sdk exec npm pack --dry-run
```

## License

MIT
