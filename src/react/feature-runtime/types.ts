'use client';

import type { ComponentType, Dispatch } from 'react';
import type {
  ConfigPayload,
  FeatureDefinition as ProtocolFeatureDefinition,
  ToolConfig as ProtocolToolConfig,
} from '../../protocol/messages';

export interface ToolExecutionResult<TData = unknown> {
  requestId: string;
  response: {
    code: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CANCELLED';
    data: TData;
  };
  componentData?: Record<string, unknown>;
  metadata?: {
    executionTime?: number;
    timestamp: string;
    toolName: string;
  };
}

export type ToolHandler<TArgs = unknown, TResult = unknown> = (
  requestId: string,
  args: TArgs,
  settings?: Record<string, unknown>,
  collections?: unknown[],
) =>
  | Promise<ToolExecutionResult<TResult>>
  | ToolExecutionResult<TResult>;

export interface FeatureDefinition extends ProtocolFeatureDefinition {
  tools: ToolConfig[];
  component?: ComponentType<FeatureComponentProps>;
  propsSelector?: (
    toolState: Record<string, unknown>,
    settings: Record<string, unknown>,
    collections: unknown[],
  ) => Record<string, unknown>;
}

export interface ToolConfig extends ProtocolToolConfig {
  settings: Record<string, unknown>;
}

export interface HistoryEntry {
  id: string;
  featureName: string;
  featureType: string;
  toolState: Record<string, unknown>;
  timestamp: string;
  firstExecutionTime: string;
  displayName: string;
  toolName?: string;
  toolType: string;
  toolExecutionCount: number;
  bucketId?: number;
}

export interface ToolExecutionState {
  isExecuting: boolean;
  executedTools: string[];
  toolResults: Record<string, ToolExecutionResult>;
  lastExecution?: {
    toolName: string;
    requestId: string;
    timestamp: string;
    status: 'pending' | 'success' | 'error';
  };
}

export interface FeatureState {
  isSessionActive: boolean;
  sessionStartTime?: string;
  execution: ToolExecutionState;
  availableFeatures: FeatureDefinition[];
  selectedFeature: string | null;
  toolState: Record<string, unknown>;
  history: HistoryEntry[];
  currentHistoryIndex: number;
  isConfigured: boolean;
  companyId?: string | number;
  configurationError?: string;
  isVisible: boolean;
  position: 'left' | 'right' | 'mobile' | 'hidden';
  lastError?: {
    message: string;
    timestamp: string;
    toolName?: string;
    requestId?: string;
  };
}

export type FeatureStateAction =
  | { type: 'SESSION_START'; payload: { timestamp: string } }
  | { type: 'SESSION_STOP'; payload?: { clearHistory?: boolean } }
  | {
      type: 'CONFIG_RECEIVED';
      payload: { features: FeatureDefinition[]; companyId?: string | number };
    }
  | { type: 'CONFIG_ERROR'; payload: { error: string } }
  | { type: 'FEATURE_SELECTED'; payload: { featureName: string } }
  | {
      type: 'TOOL_EXECUTION_START';
      payload: { toolName: string; requestId: string };
    }
  | { type: 'TOOL_EXECUTION_SUCCESS'; payload: { result: ToolExecutionResult } }
  | {
      type: 'TOOL_EXECUTION_ERROR';
      payload: { toolName: string; error: string; requestId: string };
    }
  | { type: 'TOOL_STATE_UPDATE'; payload: { toolType: string; data: unknown } }
  | {
      type: 'VISIBILITY_CHANGE';
      payload: { isVisible: boolean; position: FeatureState['position'] };
    }
  | { type: 'HISTORY_ADD'; payload: { entry: HistoryEntry } }
  | { type: 'HISTORY_NAVIGATE'; payload: { direction: 'back' | 'forward' } }
  | { type: 'HISTORY_NAVIGATE_TO'; payload: { index: number } }
  | { type: 'ERROR_CLEAR' }
  | { type: 'RESET' };

export interface ToolRegistryEntry {
  toolNames?: string[];
  component: ComponentType<Record<string, unknown>>;
  handlers: Record<string, ToolHandler>;
  primaryTool?: string;
  overlay?: boolean;
  propsSelector?: (
    toolState: Record<string, unknown>,
    settings: Record<string, unknown>,
    collections: unknown[],
  ) => Record<string, unknown>;
}

export interface ToolMapping {
  toolName: string;
  toolType: string;
  featureType: string;
  feature: FeatureDefinition;
}

export interface RegistryState {
  features: FeatureDefinition[];
  featuresMap: Record<string, FeatureDefinition>;
  toolMappings: Record<string, ToolMapping>;
  collections: unknown[];
  isInitialized: boolean;
}

export type RegistryAction =
  | { type: 'REGISTER_FEATURES'; payload: FeatureDefinition[] }
  | { type: 'REGISTER_COLLECTIONS'; payload: unknown[] }
  | { type: 'CLEAR_REGISTRY' };

export interface ConfigInput extends Omit<ConfigPayload, 'collections'> {
  type?: 'config';
  features: FeatureDefinition[];
  /** Kept loose here: the runtime forwards collections to feature components untouched. */
  collections: unknown[];
}

export interface FeatureComponentProps {
  settings: Record<string, unknown>;
  companyId?: string | number;
  collections: unknown[];
  toolState: Record<string, unknown>;
  isActive?: boolean;
}

export interface FeatureRuntimeContextValue {
  state: FeatureState;
  dispatch: Dispatch<FeatureStateAction>;
  registry: RegistryState;
  registerFeatures: (features: FeatureDefinition[]) => void;
  registerCollections: (collections: unknown[]) => void;
  startSession: () => void;
  stopSession: () => void;
  selectFeature: (featureName: string) => void;
  updateToolState: (toolType: string, data: unknown) => void;
  clearError: () => void;
  setVisibility: (isVisible: boolean, position: FeatureState['position']) => void;
  addToHistory: (entry: HistoryEntry) => void;
  navigateHistory: (direction: 'back' | 'forward') => void;
  navigateToHistoryIndex: (index: number) => void;
  getFeatureComponent: (
    featureName: string,
  ) => ComponentType<Record<string, unknown>> | null;
  getFeatureProps: (
    featureName: string,
    toolState: Record<string, unknown>,
    companyId: string | number | undefined,
  ) => Record<string, unknown>;
  getToolMapping: (toolName: string) => ToolMapping | null;
  isToolAvailable: (toolName: string) => boolean;
  executeTool: (toolName: string, requestId: string, args: unknown) => Promise<void>;
  reset: () => void;
}
