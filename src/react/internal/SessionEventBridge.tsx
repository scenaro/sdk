'use client';

import { useEffect } from 'react';
import { DATA_TOPICS, type ConfigPayload, type ConversationMessage } from '../../protocol';
import type { ScenaroEventBus } from '../events';
import type { ScenaroSession } from '../../core/ScenaroSession';

/** Forwards headless session events onto the scoped event bus (FeatureProvider, bridges). */
export function SessionEventBridge({
  session,
  events,
}: {
  session: ScenaroSession;
  events: ScenaroEventBus;
}) {
  useEffect(() => {
    const onMessage = (message: ConversationMessage) => {
      events.emit(DATA_TOPICS.MESSAGE_NEW, message as unknown as Record<string, unknown>);
    };

    const onConfig = () => {
      const raw = session.rawConfig;
      if (raw) events.emit('config', raw as unknown as Record<string, unknown>);
    };

    const onSessionEnd = (info: { reason: string }) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('scenaro-session-ended', { detail: info }));
      }
      events.emit('session:end', info);
    };

    session.on('message', onMessage);
    session.on('config', onConfig);
    session.on('session-end', onSessionEnd);

    return () => {
      session.off('message', onMessage);
      session.off('config', onConfig);
      session.off('session-end', onSessionEnd);
    };
  }, [events, session]);

  return null;
}
