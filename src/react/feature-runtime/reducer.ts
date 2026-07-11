'use client';

import type {
  FeatureDefinition,
  FeatureState,
  FeatureStateAction,
  HistoryEntry,
  RegistryAction,
  RegistryState,
  ToolMapping,
} from './types';

export function extractFeatureName(
  name: string | Record<string, string> | undefined,
): string {
  if (!name) return 'Unnamed';
  if (typeof name === 'string') return name;
  return name.en || name.fr || Object.values(name)[0] || 'Unnamed';
}

export function formatFeatureDisplayName(featureName: string): string {
  return featureName
    .split(':')
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' - ');
}

export function enrichSettingsWithCompanyId(
  settings: Record<string, unknown>,
  companyId: string | number | undefined,
): Record<string, unknown> {
  if (companyId === undefined || companyId === null) {
    return settings;
  }
  return { ...settings, company_id: companyId };
}

export function getHistoryEntryKey(entry: HistoryEntry): string {
  if (entry.featureType.startsWith('bucket:') && entry.bucketId !== undefined) {
    return `${entry.featureName}:${entry.bucketId}`;
  }
  return entry.featureName;
}

export function historyEntriesMatch(
  firstEntry: HistoryEntry,
  secondEntry: HistoryEntry,
): boolean {
  return getHistoryEntryKey(firstEntry) === getHistoryEntryKey(secondEntry);
}

export const initialState: FeatureState = {
  isSessionActive: false,
  execution: {
    isExecuting: false,
    executedTools: [],
    lastExecution: undefined,
    toolResults: {},
  },
  availableFeatures: [],
  selectedFeature: null,
  toolState: {},
  history: [],
  currentHistoryIndex: -1,
  isConfigured: false,
  isVisible: false,
  position: 'hidden',
};

type HistoryEntryWithPrimaryFlag = HistoryEntry & { isPrimaryTool?: boolean };

export function featureStateReducer(
  state: FeatureState,
  action: FeatureStateAction,
): FeatureState {
  switch (action.type) {
    case 'SESSION_START':
      return {
        ...state,
        isSessionActive: true,
        sessionStartTime: action.payload.timestamp,
        lastError: undefined,
      };

    case 'SESSION_STOP':
      if (action.payload?.clearHistory) {
        return {
          ...state,
          isSessionActive: false,
          sessionStartTime: undefined,
          execution: { ...initialState.execution },
          history: [],
          currentHistoryIndex: -1,
          selectedFeature: null,
          toolState: {},
        };
      }
      return {
        ...state,
        isSessionActive: false,
        sessionStartTime: undefined,
        execution: { ...initialState.execution },
        ...(state.history.length === 0 && {
          selectedFeature: null,
          toolState: {},
          isConfigured: false,
        }),
      };

    case 'CONFIG_RECEIVED': {
      const { features, companyId } = action.payload;
      return {
        ...state,
        availableFeatures: features,
        companyId,
        isConfigured: true,
        configurationError: undefined,
      };
    }

    case 'CONFIG_ERROR':
      return {
        ...state,
        isConfigured: false,
        configurationError: action.payload.error,
        lastError: {
          message: `Configuration error: ${action.payload.error}`,
          timestamp: new Date().toISOString(),
        },
      };

    case 'FEATURE_SELECTED':
      return {
        ...state,
        selectedFeature: action.payload.featureName,
      };

    case 'TOOL_EXECUTION_START': {
      const { toolName, requestId } = action.payload;
      return {
        ...state,
        execution: {
          ...state.execution,
          isExecuting: true,
          lastExecution: {
            toolName,
            requestId,
            timestamp: new Date().toISOString(),
            status: 'pending',
          },
        },
      };
    }

    case 'TOOL_EXECUTION_SUCCESS': {
      const { result } = action.payload;
      const toolName = result.metadata?.toolName ?? 'unknown';
      return {
        ...state,
        execution: {
          ...state.execution,
          isExecuting: false,
          executedTools: state.execution.executedTools.includes(toolName)
            ? state.execution.executedTools
            : [...state.execution.executedTools, toolName],
          toolResults: {
            ...state.execution.toolResults,
            [result.requestId]: result,
          },
          lastExecution: state.execution.lastExecution
            ? { ...state.execution.lastExecution, status: 'success' }
            : undefined,
        },
        lastError: undefined,
      };
    }

    case 'TOOL_EXECUTION_ERROR': {
      const { toolName, error, requestId } = action.payload;
      return {
        ...state,
        execution: {
          ...state.execution,
          isExecuting: false,
          lastExecution: state.execution.lastExecution
            ? { ...state.execution.lastExecution, status: 'error' }
            : undefined,
        },
        lastError: {
          message: error,
          timestamp: new Date().toISOString(),
          toolName,
          requestId,
        },
      };
    }

    case 'TOOL_STATE_UPDATE':
      return {
        ...state,
        toolState: {
          ...state.toolState,
          [action.payload.toolType]: action.payload.data,
        },
      };

    case 'VISIBILITY_CHANGE':
      return {
        ...state,
        isVisible: action.payload.isVisible,
        position: action.payload.position,
      };

    case 'HISTORY_ADD': {
      const entry = action.payload.entry as HistoryEntryWithPrimaryFlag;
      const isPrimaryToolExecution = entry.isPrimaryTool ?? false;

      let targetIndex = -1;
      for (let index = state.history.length - 1; index >= 0; index -= 1) {
        if (historyEntriesMatch(state.history[index], entry)) {
          targetIndex = index;
          break;
        }
      }

      if (targetIndex >= 0 && !isPrimaryToolExecution) {
        const nextHistory = [...state.history];
        const existing = nextHistory[targetIndex];
        const mergedToolState = {
          ...existing.toolState,
          ...entry.toolState,
        };
        nextHistory[targetIndex] = {
          ...existing,
          toolState: mergedToolState,
          timestamp: entry.timestamp,
          toolName: entry.toolName,
          toolType: entry.toolType,
          toolExecutionCount: existing.toolExecutionCount + 1,
        };

        return {
          ...state,
          history: nextHistory,
          currentHistoryIndex: targetIndex,
          selectedFeature: entry.featureName,
          toolState: mergedToolState,
        };
      }

      const nextHistory = [...state.history, entry];
      return {
        ...state,
        history: nextHistory,
        currentHistoryIndex: nextHistory.length - 1,
        selectedFeature: entry.featureName,
        toolState: entry.toolState,
      };
    }

    case 'HISTORY_NAVIGATE': {
      const { direction } = action.payload;
      let nextIndex = state.currentHistoryIndex;
      if (direction === 'back' && state.currentHistoryIndex > 0) {
        nextIndex = state.currentHistoryIndex - 1;
      } else if (
        direction === 'forward' &&
        state.currentHistoryIndex < state.history.length - 1
      ) {
        nextIndex = state.currentHistoryIndex + 1;
      }

      if (nextIndex === state.currentHistoryIndex) {
        return state;
      }

      const historyEntry = state.history[nextIndex];
      return {
        ...state,
        currentHistoryIndex: nextIndex,
        selectedFeature: historyEntry.featureName,
        toolState: historyEntry.toolState,
      };
    }

    case 'HISTORY_NAVIGATE_TO': {
      const { index } = action.payload;
      if (
        index < 0 ||
        index >= state.history.length ||
        index === state.currentHistoryIndex
      ) {
        return state;
      }

      const historyEntry = state.history[index];
      return {
        ...state,
        currentHistoryIndex: index,
        selectedFeature: historyEntry.featureName,
        toolState: historyEntry.toolState,
      };
    }

    case 'ERROR_CLEAR':
      return {
        ...state,
        lastError: undefined,
        configurationError: undefined,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

export const initialRegistryState: RegistryState = {
  features: [],
  featuresMap: {},
  toolMappings: {},
  collections: [],
  isInitialized: false,
};

export function registryReducer(
  state: RegistryState,
  action: RegistryAction,
): RegistryState {
  switch (action.type) {
    case 'REGISTER_FEATURES': {
      const features = action.payload;
      const featuresMap: Record<string, FeatureDefinition> = {};
      const toolMappings: Record<string, ToolMapping> = {};

      features.forEach((feature) => {
        const featureName = extractFeatureName(feature.name);
        featuresMap[featureName] = feature;
        feature.tools.forEach((tool) => {
          toolMappings[tool.name] = {
            toolName: tool.name,
            toolType: tool.type,
            featureType: feature.type,
            feature,
          };
        });
      });

      return {
        ...state,
        features,
        featuresMap,
        toolMappings,
        isInitialized: true,
      };
    }

    case 'REGISTER_COLLECTIONS':
      return { ...state, collections: action.payload };

    case 'CLEAR_REGISTRY':
      return initialRegistryState;

    default:
      return state;
  }
}
