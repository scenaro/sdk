import { describe, expect, it, vi } from 'vitest';
import { ScenaroSession } from './ScenaroSession';
import type { Transport, TransportDataMessage } from './transport';
import type { ScenaroClient } from '../client';

describe('session lifecycle after provider cleanup', () => {
  it('receives configuration after StrictMode cleanup and does not duplicate listeners on restart', async () => {
    const listeners = new Set<(message: TransportDataMessage) => void>();
    const unsubscribe = vi.fn();
    const transport: Transport = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn().mockResolvedValue(undefined),
      publishData: vi.fn().mockResolvedValue(undefined),
      registerToolHandler: () => {}, unregisterToolHandler: () => {},
      onData: handler => {
        listeners.add(handler);
        return () => { listeners.delete(handler); unsubscribe(); };
      },
      onConnectionStateChange: () => () => {},
      onAgentPresenceChange: () => () => {},
      onAgentStateChange: () => () => {},
      getEngineHandle: () => null,
    };
    const client = {} as ScenaroClient;
    const session = new ScenaroSession({ client, transport });
    const configHandler = vi.fn();
    session.on('config', configHandler);
    // React StrictMode runs the provider's cleanup before the user starts.
    session.destroy();
    expect(listeners.size).toBe(0);
    const start = () => session.start({
      scenario: 'test', inputMode: 'text', microphone: false,
      connection: { livekitUrl: 'wss://test', livekitToken: 'test' },
    });
    await start();
    const payload = {
      features: [{ name: 'Wine search', type: 'collection:items:search', settings: { animation: { key: 'wine_brief' } }, tools: [] }],
      collections: [],
    };
    for (const receive of listeners) receive({ topic: 'config', payload: new TextEncoder().encode(JSON.stringify(payload)) });
    expect(session.rawConfig).toEqual(payload);
    expect(configHandler).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    await session.end();
    await start();
    expect(listeners.size).toBe(1);
    session.destroy();
    expect(listeners.size).toBe(0);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
