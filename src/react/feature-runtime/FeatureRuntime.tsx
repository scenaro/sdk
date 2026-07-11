'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { useScenaroEvents, useScenaro } from '../ScenaroProvider';
import type { Room } from '../../transport/livekit';
import { useFeatureToolRpc } from './useFeatureToolRpc';
import {
  enrichSettingsWithCompanyId,
  extractFeatureName,
  featureStateReducer,
  formatFeatureDisplayName,
  initialRegistryState,
  initialState,
  registryReducer,
} from './reducer';
import type {
  ConfigInput,
  FeatureDefinition,
  FeatureRuntimeContextValue,
  FeatureState,
  HistoryEntry,
  ToolExecutionResult,
  ToolMapping,
  ToolRegistryEntry,
} from './types';

const FeatureRuntimeContext = createContext<FeatureRuntimeContextValue | null>(
  null,
);

export interface FeatureProviderProps {
  children: ReactNode;
  registry: Map<string, ToolRegistryEntry>;
  clearHistoryOnSessionEnd?: boolean;
  onResetBuckets?: () => void;
  initialVisibility?: boolean;
  initialPosition?: FeatureState['position'];
}

type ToolExecutePayload = Record<string, unknown>;

function normalizeConfigPayload(input: Record<string, unknown>): ConfigInput | null {
  const data =
    input.config && typeof input.config === 'object'
      ? (input.config as Record<string, unknown>)
      : input;
  const features = data.features;
  const collections = data.collections;

  if (!Array.isArray(features)) {
    return null;
  }

  return {
    ...(data as unknown as ConfigInput),
    type: 'config',
    features: features as FeatureDefinition[],
    collections: Array.isArray(collections) ? collections : [],
  };
}

function normalizeToolExecutePayload(input: ToolExecutePayload): {
  toolName: string | null;
  requestId: string;
  args: unknown;
} {
  const toolNameValue =
    input.toolName ?? input.name ?? input.tool_name ?? input.tool ?? null;
  const toolName = typeof toolNameValue === 'string' ? toolNameValue : null;
  const requestIdValue = input.requestId ?? input.request_id;
  const generatedRequestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requestId =
    typeof requestIdValue === 'string' && requestIdValue.length > 0
      ? requestIdValue
      : generatedRequestId;

  return {
    toolName,
    requestId,
    args: input.args ?? input.data ?? {},
  };
}

export function FeatureProvider({
  children,
  registry,
  clearHistoryOnSessionEnd = false,
  onResetBuckets,
  initialVisibility = false,
  initialPosition = 'hidden',
}: FeatureProviderProps) {
  const { session } = useScenaro();
  const events = useScenaroEvents();
  useFeatureToolRpc((session.room as Room | null) ?? null);
  const [state, dispatch] = useReducer(featureStateReducer, {
    ...initialState,
    isVisible: initialVisibility,
    position: initialPosition,
  });
  const [registryState, dispatchRegistry] = useReducer(
    registryReducer,
    initialRegistryState,
  );

  const registerFeatures = useCallback((features: FeatureDefinition[]) => {
    dispatchRegistry({ type: 'REGISTER_FEATURES', payload: features });
  }, []);

  const registerCollections = useCallback((collections: unknown[]) => {
    dispatchRegistry({ type: 'REGISTER_COLLECTIONS', payload: collections });
  }, []);

  const getToolMapping = useCallback(
    (toolName: string): ToolMapping | null =>
      registryState.toolMappings[toolName] ?? null,
    [registryState.toolMappings],
  );

  const getFeatureComponent = useCallback(
    (featureName: string) => {
      const feature = registryState.featuresMap[featureName];
      if (!feature) return null;
      const featureEntry = registry.get(feature.type);
      if (!featureEntry) return null;
      return featureEntry.component;
    },
    [registry, registryState.featuresMap],
  );

  const getFeatureProps = useCallback(
    (
      featureName: string,
      toolState: Record<string, unknown>,
      companyId: string | number | undefined,
    ): Record<string, unknown> => {
      const feature = registryState.featuresMap[featureName];
      if (!feature) return {};
      const featureEntry = registry.get(feature.type);
      if (!featureEntry?.propsSelector) return {};

      const enrichedSettings = enrichSettingsWithCompanyId(
        feature.settings,
        companyId,
      );
      return featureEntry.propsSelector(
        toolState,
        enrichedSettings,
        registryState.collections,
      );
    },
    [registry, registryState.collections, registryState.featuresMap],
  );

  const isToolAvailable = useCallback(
    (toolName: string): boolean => toolName in registryState.toolMappings,
    [registryState.toolMappings],
  );

  const executeTool = useCallback(
    async (toolName: string, requestId: string, args: unknown): Promise<void> => {
      const mapping = getToolMapping(toolName);
      const featureRegistryEntry = mapping
        ? registry.get(mapping.featureType)
        : undefined;
      const isOverlayTool = featureRegistryEntry?.overlay === true;

      if (!isOverlayTool) {
        events.emit('feature:show', {
          reason: 'tool_execution',
          toolName,
          requestId,
        });
      }

      dispatch({
        type: 'TOOL_EXECUTION_START',
        payload: { toolName, requestId },
      });

      try {
        if (!mapping) {
          throw new Error(`Tool mapping not found for: ${toolName}`);
        }

        if (!featureRegistryEntry?.handlers) {
          throw new Error(
            `No handlers found for feature type: ${mapping.featureType}`,
          );
        }

        const handler =
          featureRegistryEntry.handlers[mapping.toolType] ??
          featureRegistryEntry.handlers[mapping.toolName];

        if (!handler) {
          throw new Error(
            `Handler not found for tool type "${mapping.toolType}" or name "${mapping.toolName}" (feature: ${mapping.featureType})`,
          );
        }

        const enrichedSettings = enrichSettingsWithCompanyId(
          mapping.feature.settings,
          state.companyId,
        );

        const rawResult = await Promise.resolve(
          handler(requestId, args, enrichedSettings, registryState.collections),
        );
        const result = rawResult as ToolExecutionResult;

        const enhancedResult: ToolExecutionResult = {
          ...result,
          metadata: {
            ...result.metadata,
            toolName,
            timestamp: new Date().toISOString(),
          },
        };

        dispatch({
          type: 'TOOL_EXECUTION_SUCCESS',
          payload: { result: enhancedResult },
        });

        const componentData = result.componentData ?? {};
        dispatch({
          type: 'TOOL_STATE_UPDATE',
          payload: { toolType: mapping.toolType, data: componentData },
        });

        const currentTime = new Date().toISOString();
        const bucketSetting = mapping.feature.settings.bucket_id;
        const bucketId =
          mapping.featureType.startsWith('bucket:') &&
          (typeof bucketSetting === 'number' || typeof bucketSetting === 'string')
            ? Number(bucketSetting)
            : undefined;
        const isPrimaryTool =
          !!featureRegistryEntry.primaryTool &&
          featureRegistryEntry.primaryTool === mapping.toolType;

        const historyEntry: HistoryEntry & { isPrimaryTool?: boolean } = {
          id: requestId,
          featureName: extractFeatureName(mapping.feature.name),
          featureType: mapping.featureType,
          toolState: { [mapping.toolType]: componentData },
          timestamp: currentTime,
          firstExecutionTime: currentTime,
          displayName: formatFeatureDisplayName(
            extractFeatureName(mapping.feature.name),
          ),
          toolName,
          toolType: mapping.toolType,
          toolExecutionCount: 1,
          bucketId,
          isPrimaryTool,
        };

        dispatch({
          type: 'HISTORY_ADD',
          payload: { entry: historyEntry },
        });

        events.emit('tool:response', {
          requestId,
          response: result.response,
        });

        if (
          isOverlayTool &&
          componentData &&
          Array.isArray(componentData.suggestions)
        ) {
          events.emit('suggestions:show', {
            suggestions: componentData.suggestions as unknown[],
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        dispatch({
          type: 'TOOL_EXECUTION_ERROR',
          payload: { toolName, error: errorMessage, requestId },
        });
        events.emit('tool:error', {
          requestId,
          toolName,
          error: errorMessage,
        });
      }
    },
    [
      events,
      getToolMapping,
      registry,
      registryState.collections,
      state.companyId,
    ],
  );

  const startSession = useCallback(() => {
    dispatch({
      type: 'SESSION_START',
      payload: { timestamp: new Date().toISOString() },
    });
  }, []);

  const stopSession = useCallback(() => {
    dispatch({
      type: 'SESSION_STOP',
      payload: { clearHistory: clearHistoryOnSessionEnd },
    });
  }, [clearHistoryOnSessionEnd]);

  const selectFeature = useCallback((featureName: string) => {
    dispatch({ type: 'FEATURE_SELECTED', payload: { featureName } });
  }, []);

  const updateToolState = useCallback((toolType: string, data: unknown) => {
    dispatch({ type: 'TOOL_STATE_UPDATE', payload: { toolType, data } });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'ERROR_CLEAR' });
  }, []);

  const setVisibility = useCallback(
    (isVisible: boolean, position: FeatureState['position']) => {
      dispatch({ type: 'VISIBILITY_CHANGE', payload: { isVisible, position } });
    },
    [],
  );

  const navigateHistory = useCallback((direction: 'back' | 'forward') => {
    dispatch({ type: 'HISTORY_NAVIGATE', payload: { direction } });
  }, []);

  const navigateToHistoryIndex = useCallback((index: number) => {
    dispatch({ type: 'HISTORY_NAVIGATE_TO', payload: { index } });
  }, []);

  const addToHistory = useCallback((entry: HistoryEntry) => {
    dispatch({ type: 'HISTORY_ADD', payload: { entry } });
  }, []);

  const reset = useCallback(() => {
    onResetBuckets?.();
    dispatch({ type: 'RESET' });
    dispatchRegistry({ type: 'CLEAR_REGISTRY' });
  }, [onResetBuckets]);

  useEffect(() => {
    const onConfig = (payload: Record<string, unknown>) => {
      const config = normalizeConfigPayload(payload);
      if (!config) {
        dispatch({
          type: 'CONFIG_ERROR',
          payload: { error: 'Invalid config payload received.' },
        });
        return;
      }

      registerFeatures(config.features);
      registerCollections(config.collections);
      dispatch({
        type: 'CONFIG_RECEIVED',
        payload: {
          features: config.features,
          companyId: config.company_id,
        },
      });
    };

    const onToolExecute = (payload: Record<string, unknown>) => {
      const normalized = normalizeToolExecutePayload(payload);
      if (!normalized.toolName) {
        events.emit('tool:error', {
          requestId: normalized.requestId,
          toolName: 'unknown',
          error: 'Invalid tool execution payload: missing tool name.',
        });
        return;
      }

      void executeTool(normalized.toolName, normalized.requestId, normalized.args);
    };

    const onConversationReset = () => {
      reset();
    };

    const onSessionEnd = () => {
      stopSession();
    };

    events.on('config', onConfig);
    events.on('tool:execute', onToolExecute);
    events.on('conversation:reset', onConversationReset);
    events.on('session:end', onSessionEnd);

    return () => {
      events.off('config', onConfig);
      events.off('tool:execute', onToolExecute);
      events.off('conversation:reset', onConversationReset);
      events.off('session:end', onSessionEnd);
    };
  }, [
    events,
    executeTool,
    registerCollections,
    registerFeatures,
    reset,
    stopSession,
  ]);

  useEffect(() => {
    if (state.isVisible && state.isConfigured && !state.isSessionActive) {
      startSession();
    }
  }, [startSession, state.isConfigured, state.isSessionActive, state.isVisible]);

  const value = useMemo<FeatureRuntimeContextValue>(
    () => ({
      state,
      dispatch,
      registry: registryState,
      registerFeatures,
      registerCollections,
      startSession,
      stopSession,
      selectFeature,
      updateToolState,
      clearError,
      setVisibility,
      addToHistory,
      navigateHistory,
      navigateToHistoryIndex,
      getFeatureComponent,
      getFeatureProps,
      getToolMapping,
      isToolAvailable,
      executeTool,
      reset,
    }),
    [
      addToHistory,
      clearError,
      executeTool,
      getFeatureComponent,
      getFeatureProps,
      getToolMapping,
      isToolAvailable,
      navigateHistory,
      navigateToHistoryIndex,
      registerCollections,
      registerFeatures,
      registryState,
      reset,
      selectFeature,
      setVisibility,
      startSession,
      state,
      stopSession,
      updateToolState,
    ],
  );

  return (
    <FeatureRuntimeContext.Provider value={value}>
      {children}
    </FeatureRuntimeContext.Provider>
  );
}

export function useFeatures(): FeatureRuntimeContextValue {
  const context = useContext(FeatureRuntimeContext);
  if (!context) {
    throw new Error('useFeatures must be used within a FeatureProvider');
  }
  return context;
}
