'use client';

import { useVoiceAssistant } from '@livekit/components-react';
import { useCallback, useEffect, useRef } from 'react';
import {
  DATA_TOPICS,
  RPC_TIMEOUTS,
  resolveRpcMethodName,
  type ConfigPayload,
  type ToolConfig,
} from '../../protocol';
import type { Room } from '../../transport/livekit';
import { useScenaroEvents } from '../ScenaroProvider';
import {
  getActivitySnapshot,
  onVoiceAssistantStateChange,
  recordUiActivity,
  startUiActivityTracking,
  stopUiActivityTracking,
  UI_ACTIVITY_RPC_METHOD,
} from '../internal/ui-activity-tracker';

function extractRpcMethodNamesFromConfig(config: ConfigPayload): string[] {
  const names: string[] = [];
  config.features?.forEach((feature) => {
    feature.tools?.forEach((tool: ToolConfig) => {
      const method = resolveRpcMethodName(tool);
      if (method) names.push(method);
    });
  });
  return names;
}

/** Registers feature-tool RPC handlers and ui-activity RPC for SDK FeatureProvider. */
export function useFeatureToolRpc(room: Room | null) {
  const events = useScenaroEvents();
  const { state: voiceAssistantState } = useVoiceAssistant();
  const registeredTools = useRef(new Set<string>());
  const pendingResponses = useRef(new Map<string, (response: string) => void>());
  const uiActivityRpcRegistered = useRef(false);

  const registerToolRpc = useCallback(
    (toolName: string) => {
      if (!room || registeredTools.current.has(toolName)) return;

      try {
        room.registerRpcMethod(toolName, async (data) => {
          try {
            const params = JSON.parse(data.payload) as {
              requestId: string;
              args?: Record<string, unknown>;
            };
            const { requestId, args } = params;

            return new Promise<string>((resolve, reject) => {
              pendingResponses.current.set(requestId, resolve);

              const timeoutId = setTimeout(() => {
                if (pendingResponses.current.has(requestId)) {
                  pendingResponses.current.delete(requestId);
                  reject(new Error(`Tool execution timeout for ${toolName}`));
                }
              }, RPC_TIMEOUTS.FRONTEND_TOOL_MS);

              const onResponse = (payload: Record<string, unknown>) => {
                if (payload.requestId !== requestId) return;
                clearTimeout(timeoutId);
                pendingResponses.current.delete(requestId);
                events.off('tool:response', onResponse);
                events.off('tool:error', onError);
                resolve(
                  JSON.stringify({
                    requestId,
                    code: (payload.response as { code?: string })?.code ?? 'SUCCESS',
                    data: (payload.response as { data?: unknown })?.data,
                  }),
                );
              };

              const onError = (payload: Record<string, unknown>) => {
                if (payload.requestId !== requestId) return;
                clearTimeout(timeoutId);
                pendingResponses.current.delete(requestId);
                events.off('tool:response', onResponse);
                events.off('tool:error', onError);
                resolve(
                  JSON.stringify({
                    requestId,
                    code: 'ERROR',
                    data: {
                      error: payload.error ?? 'Unknown error',
                      toolName: payload.toolName ?? toolName,
                    },
                  }),
                );
              };

              events.on('tool:response', onResponse);
              events.on('tool:error', onError);
              events.emit('tool:execute', { toolName, requestId, args: args ?? {} });
            });
          } catch (error) {
            console.error('[FeatureProvider] Error parsing RPC data:', error);
            throw error;
          }
        });

        registeredTools.current.add(toolName);
      } catch (error) {
        console.error(`[FeatureProvider] Failed to register RPC tool: ${toolName}`, error);
      }
    },
    [events, room],
  );

  const unregisterAllRpcTools = useCallback(() => {
    if (!room) return;
    registeredTools.current.forEach((toolName) => {
      try {
        room.unregisterRpcMethod(toolName);
      } catch {
        // ignore
      }
    });
    registeredTools.current.clear();
  }, [room]);

  useEffect(() => {
    onVoiceAssistantStateChange(voiceAssistantState);
  }, [voiceAssistantState]);

  useEffect(() => {
    if (!room || uiActivityRpcRegistered.current) return undefined;

    startUiActivityTracking();

    try {
      room.registerRpcMethod(UI_ACTIVITY_RPC_METHOD, async (data) => {
        let idleThresholdMs = 120000;
        try {
          const parsed = JSON.parse(data?.payload || '{}') as { idle_threshold_ms?: number };
          if (typeof parsed.idle_threshold_ms === 'number') {
            idleThresholdMs = parsed.idle_threshold_ms;
          }
        } catch {
          // default threshold
        }
        return JSON.stringify(getActivitySnapshot(idleThresholdMs));
      });
      uiActivityRpcRegistered.current = true;
    } catch (error) {
      console.warn('[FeatureProvider] Failed to register UI activity RPC:', error);
    }

    return () => {
      stopUiActivityTracking();
      if (uiActivityRpcRegistered.current) {
        try {
          room.unregisterRpcMethod(UI_ACTIVITY_RPC_METHOD);
        } catch {
          // ignore
        }
        uiActivityRpcRegistered.current = false;
      }
    };
  }, [room]);

  useEffect(() => {
    if (!room) {
      pendingResponses.current.clear();
      return undefined;
    }

    const handleDisconnected = () => {
      pendingResponses.current.clear();
      unregisterAllRpcTools();
    };

    room.on('disconnected', handleDisconnected);
    return () => {
      room.off('disconnected', handleDisconnected);
      unregisterAllRpcTools();
    };
  }, [room, unregisterAllRpcTools]);

  useEffect(() => {
    const onConfig = (payload: Record<string, unknown>) => {
      recordUiActivity('message');
      const config = payload as unknown as ConfigPayload;
      extractRpcMethodNamesFromConfig(config).forEach(registerToolRpc);
    };

    events.on('config', onConfig);
    return () => {
      events.off('config', onConfig);
    };
  }, [events, registerToolRpc]);

  useEffect(() => {
    if (!room) return undefined;

    const requestConfig = () => {
      try {
        const payload = new TextEncoder().encode(JSON.stringify({ requestedAt: Date.now() }));
        room.localParticipant.publishData(payload, { topic: DATA_TOPICS.CONFIG_REQUEST });
      } catch (error) {
        console.warn('[FeatureProvider] Failed to request config:', error);
      }
    };

    if (room.state === 'connected') requestConfig();
    room.on('connected', requestConfig);
    return () => {
      room.off('connected', requestConfig);
    };
  }, [room]);
}
