'use client';

import { RoomContext } from '@livekit/components-react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { createScenaroClient, type ScenaroClient } from '../client';
import { ScenaroSession, type ScenaroSessionOptions } from '../core/ScenaroSession';
import type { Room } from '../transport/livekit';
import { ScenaroEventBus } from './events';
import { SessionEventBridge } from './internal/SessionEventBridge';

export interface ScenaroProviderValue {
  client: ScenaroClient;
  events: ScenaroEventBus;
  /** Shared `ScenaroSession` backing `useScenaroSession()`. */
  session: ScenaroSession;
}

const ScenaroContext = createContext<ScenaroProviderValue | null>(null);

/** Same options as the headless `ScenaroSession`, minus the test-only transport injection. */
export interface ScenaroProviderProps extends Omit<ScenaroSessionOptions, 'transport'> {
  children: ReactNode;
}

export function ScenaroProvider({
  children,
  client: clientProp,
  apiUrl,
  storagePrefix,
  storage,
  apiPathPrefix,
}: ScenaroProviderProps) {
  const value = useMemo<ScenaroProviderValue>(() => {
    const client =
      clientProp ??
      createScenaroClient({
        apiUrl: apiUrl ?? '',
        storagePrefix,
        storage,
        apiPathPrefix,
      });
    if (!clientProp && !apiUrl) {
      throw new Error('ScenaroProvider requires either `client` or `apiUrl`');
    }
    return { client, events: new ScenaroEventBus(), session: new ScenaroSession({ client }) };
  }, [clientProp, apiUrl, storagePrefix, storage, apiPathPrefix]);

  // Releases the session's transport listeners/timers whenever it's replaced or the
  // provider unmounts — `value.session` is a fresh instance every time this effect reruns.
  useEffect(() => () => value.session.destroy(), [value.session]);

  return (
    <ScenaroContext.Provider value={value}>
      <SessionEventBridge session={value.session} events={value.events} />
      {/* Injected silently so @livekit/components-react works with `useScenaroSession()`
          without manual RoomContext wiring — see docs/guides/advanced-livekit-integration. */}
      <RoomContext.Provider value={value.session.room as Room}>{children}</RoomContext.Provider>
    </ScenaroContext.Provider>
  );
}

export function useScenaro(): ScenaroProviderValue {
  const ctx = useContext(ScenaroContext);
  if (!ctx) {
    throw new Error('useScenaro must be used within a ScenaroProvider');
  }
  return ctx;
}

export function useScenaroClient(): ScenaroClient {
  return useScenaro().client;
}

export function useScenaroEvents(): ScenaroEventBus {
  return useScenaro().events;
}
