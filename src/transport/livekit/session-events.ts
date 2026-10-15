import type { Room } from 'livekit-client';
import { DATA_TOPICS } from '../../protocol';
import type { ScenarioEventBehavior } from '../../core';

function makeClientEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function publish(
  room: Room,
  topic: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!room?.localParticipant) return false;
  await room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify(payload)),
    { topic, reliable: true },
  );
  return true;
}

export function fireScenarioEvent(
  room: Room,
  featureName: string,
  eventName: string,
  data: Record<string, unknown> = {},
  options: { behavior?: ScenarioEventBehavior } = {},
): Promise<boolean> {
  return publish(room, DATA_TOPICS.EVENT_FIRE, {
    feature_name: featureName,
    event_name: eventName,
    data,
    fired_at: new Date().toISOString(),
    client_event_id: makeClientEventId('evt'),
    ...(options.behavior ? { behavior: options.behavior } : {}),
  });
}

export function sendExperienceStateUpdate(
  room: Room,
  experienceState: Record<string, unknown>,
): Promise<boolean> {
  return publish(room, DATA_TOPICS.STATE_UPDATE, {
    experience_state: experienceState,
    fired_at: new Date().toISOString(),
    client_event_id: makeClientEventId('state'),
  });
}

export function exchangeModeFor(
  inputMode: string,
  outputMode: string,
): 'voice' | 'hybrid' | 'text' | 'audio_text' {
  if (inputMode === 'text' && outputMode === 'audio') return 'hybrid';
  if (inputMode === 'text') return 'text';
  if (outputMode === 'text') return 'audio_text';
  return 'voice';
}

export function sendSessionControl(
  room: Room,
  options: {
    discreteMode?: boolean;
    dictationMode?: boolean;
    manualAudio?: boolean;
    outputAudio?: boolean;
    listenOnly?: boolean;
    exchangeMode?: 'voice' | 'hybrid' | 'text' | 'audio_text';
    handoff?: 'mode_switch';
  } = {},
): Promise<boolean> {
  return publish(room, DATA_TOPICS.SESSION_CONTROL, {
    fired_at: new Date().toISOString(),
    client_event_id: makeClientEventId('session'),
    ...(options.discreteMode !== undefined
      ? { discrete_mode: options.discreteMode }
      : {}),
    ...(options.dictationMode !== undefined
      ? { dictation_mode: options.dictationMode }
      : {}),
    ...(options.manualAudio !== undefined
      ? { manual_audio: options.manualAudio }
      : {}),
    ...(options.outputAudio !== undefined
      ? { output_audio: options.outputAudio }
      : {}),
    ...(options.listenOnly !== undefined
      ? { listen_only: options.listenOnly }
      : {}),
    ...(options.exchangeMode !== undefined
      ? { exchange_mode: options.exchangeMode }
      : {}),
    ...(options.handoff !== undefined ? { handoff: options.handoff } : {}),
  });
}

export function sendAssistantInterrupt(room: Room): Promise<boolean> {
  return publish(room, DATA_TOPICS.ASSISTANT_INTERRUPT, {
    fired_at: new Date().toISOString(),
    client_event_id: makeClientEventId('interrupt'),
  });
}
