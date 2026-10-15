// Current API — session contract + feature runtime.
export * from './ScenaroProvider';
export * from './events';
export * from './useScenaroSession';
export {
  UI_ACTIVITY_RPC_METHOD,
  getActivitySnapshot,
  onVoiceAssistantStateChange,
  recordUiActivity,
  startUiActivityTracking,
  stopUiActivityTracking,
} from './internal/ui-activity-tracker';
export { FeatureProvider, useFeatures } from './feature-runtime';
export type {
  FeatureProviderProps,
  FeatureRuntimeContextValue,
  ToolHandler,
  ToolRegistryEntry,
} from './feature-runtime';
export type { UseScenaroSessionOptions, UseScenaroSessionReturn } from './useScenaroSession';
export type { ScenaroProviderProps, ScenaroProviderValue } from './ScenaroProvider';

export type { CollectionItemContext, ContextCollectionItem, AgentItemEnvelope } from '../core/collection-item-context';
export { useCollectionItemContext } from './useCollectionItemContext';
