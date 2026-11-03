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

## Word-based evaluation

Set `feature.settings.animation.min_new_words` to an integer from 1 to 100 (default 5). The observer evaluates after at least that many additional words since the last dispatched check. Revisions of the same partial do not count as additional words just because another STT packet arrived. Only one request runs at a time; pending partials are coalesced. No timer or polling cadence is used. The legacy `interval_ms` field is accepted for older scenario versions but ignored.

Each committed user message also queues a final evaluation for any text delta since the last request, even below the word threshold. An identical snapshot is skipped, including when its streaming request is still in flight. This uses LiveKit `conversation_item_added`, filtered to genuine user messages, rather than each `is_final` STT segment. Queued final checks are not overwritten by later partials; repeated events for the same turn ID are deduplicated. All checks remain bounded by the activation quota and frontend activation lifecycle.

Keep the observer active until the brief exits if end-of-turn checks are required, including when all visual categories are already checked. Stopping an activation still cancels its outstanding work.
