'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScenaroError } from '../core/errors';
import type {
  AgentState,
  SessionConfig,
  SessionEndInfo,
  SessionStatus,
  StartSessionOptions,
  ToolHandler,
} from '../core/types';
import type { ConversationMessage, ConfigPayload } from '../protocol';
import type { Room } from '../transport/livekit';
import { useScenaro } from './ScenaroProvider';

export interface UseScenaroSessionOptions extends Omit<StartSessionOptions, 'tools'> {
  tools?: Record<string, ToolHandler>;
  onMessage?: (message: ConversationMessage) => void;
  onError?: (error: ScenaroError) => void;
  onSessionEnd?: (info: SessionEndInfo) => void;
}

export interface UseScenaroSessionReturn {
  status: SessionStatus;
  agentState: AgentState;
  error: ScenaroError | null;
  messages: ConversationMessage[];
  config: SessionConfig | null;
  /** Wire-format config (restore_state, tool wiring, snake_case fields). */
  rawConfig: ConfigPayload | null;
  conversationId: string | null;
  start: (overrides?: Partial<StartSessionOptions>) => Promise<void>;
  end: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  /** Extension LiveKit — non-portable, see docs/guides/advanced-livekit-integration. */
  room: Room | null;
}

/**
 * Single entry point for the Scenaro voice session contract. Requires an ancestor
 * `ScenaroProvider`, which owns the underlying session and injects `RoomContext`
 * so `@livekit/components-react` works without extra wiring (see the advanced guide).
 */
export function useScenaroSession(options: UseScenaroSessionOptions): UseScenaroSessionReturn {
  const { session } = useScenaro();

  const [status, setStatus] = useState(session.status);
  const [agentState, setAgentState] = useState(session.agentState);
  const [error, setError] = useState<ScenaroError | null>(null);
  const [messages, setMessages] = useState(session.messages);
  const [config, setConfig] = useState(session.config);
  const [rawConfig, setRawConfig] = useState(session.rawConfig);
  const [conversationId, setConversationId] = useState(session.conversationId);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const onStatusChange = (next: SessionStatus) => setStatus(next);
    const onAgentState = (next: AgentState) => setAgentState(next);
    const onMessage = (message: ConversationMessage) => {
      setMessages((prev) => [...prev, message]);
      setConversationId(session.conversationId);
      optionsRef.current.onMessage?.(message);
    };
    const onConfig = (next: SessionConfig) => {
      setConfig(next);
      setRawConfig(session.rawConfig);
      setConversationId(session.conversationId);
    };
    const onSessionEnd = (info: SessionEndInfo) => optionsRef.current.onSessionEnd?.(info);
    const onError = (next: ScenaroError) => {
      setError(next);
      optionsRef.current.onError?.(next);
    };

    session.on('status-change', onStatusChange);
    session.on('agent-state', onAgentState);
    session.on('message', onMessage);
    session.on('config', onConfig);
    session.on('session-end', onSessionEnd);
    session.on('error', onError);

    return () => {
      session.off('status-change', onStatusChange);
      session.off('agent-state', onAgentState);
      session.off('message', onMessage);
      session.off('config', onConfig);
      session.off('session-end', onSessionEnd);
      session.off('error', onError);
    };
  }, [session]);

  const start = useCallback(
    async (overrides: Partial<StartSessionOptions> = {}) => {
      setError(null);
      try {
        await session.start({ ...optionsRef.current, ...overrides });
      } catch (err) {
        const scenaroError =
          err instanceof ScenaroError ? err : new ScenaroError('SESSION_START_FAILED', 'Failed to start session', err);
        setError(scenaroError);
        optionsRef.current.onError?.(scenaroError);
        throw scenaroError;
      }
    },
    [session],
  );

  const end = useCallback(() => session.end(), [session]);
  const sendText = useCallback((text: string) => session.sendText(text), [session]);
  const setMicrophoneEnabled = useCallback((enabled: boolean) => session.setMicrophoneEnabled(enabled), [session]);

  return {
    status,
    agentState,
    error,
    messages,
    config,
    rawConfig,
    conversationId,
    start,
    end,
    sendText,
    setMicrophoneEnabled,
    room: (session.room as Room | null) ?? null,
  };
}
