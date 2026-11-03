# Frontend-controlled transcription evaluation

Configure a dedicated `animation` model on the scenario service and an `animation`
namespace inside the feature settings. The initial engine uses Jev Noul questions.
The agent stays idle until the frontend calls `startAnimation(featureKey)`.

```ts
const activation = await session.startAnimation('wine_brief');
const handler = (result: AnimationResult) => {
  if (result.activation_id !== activation) return;
  for (const [id, answer] of Object.entries(result.answers)) {
    // This state belongs to the experience, not the agent or the SDK transport.
    checked[id] = checked[id] || answer.noul >= config.ui.activation_threshold;
  }
};
session.on('animation-result', handler);
// Screen exit: ignore results immediately, then stop the remote observer.
session.off('animation-result', handler);
await session.stopAnimation(activation);
```

Subscribe before starting if every result must be observed. React consumers can use
`useScenaroSession({..., onAnimationResult, onAnimationError})` and its
`startAnimation` / `stopAnimation` methods. Keep cumulative state in the store for
the brief, not in the component owning a transient activation. If an async start
finishes after a screen unmount, immediately stop the returned activation.

A new activation replaces the previous one. Stops for older IDs are harmless.
Disconnect/reconnect clears SDK activation tracking; explicitly restart when the
screen is ready again. The frontend decides when to reset its cumulative state.
`animation-error` contains a technical error code and the activation identity.
No automatic retry, reset, animation or voice reply is performed by this API.
