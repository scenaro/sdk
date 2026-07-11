export interface ToolConfig {
  name: string;
  type: string;
  settings?: Record<string, unknown>;
  frontend_method?: string;
  rpc_timeout_s?: number;
}

export interface FeatureDefinition {
  name: string | Record<string, string>;
  type: string;
  settings: Record<string, unknown>;
  tools: ToolConfig[];
}

/** How a collection item maps onto a display template (compiled server-side per scenario version). */
export interface CollectionView {
  template: string;
  mapping: Record<string, string>;
}

export interface CollectionSearchField {
  name: string;
  index_type: 'semantic' | 'full_text' | string;
}

export interface CollectionFilterField {
  name: string;
  filter_key: string;
  field_type: 'string' | 'number' | 'boolean' | string;
  enum_options?: Array<{ value: string; label: string }>;
}

/**
 * A content collection attached to the scenario, as compiled into the published version
 * (see platform-api `generation_service.go`). Wire shape — snake_case like the rest of
 * the protocol module.
 */
export interface Collection {
  id: number;
  name: string;
  description: string;
  company_id: number;
  default_view_id?: number;
  view?: CollectionView;
  search_fields?: CollectionSearchField[];
  filter_fields?: CollectionFilterField[];
}

export interface ConfigPayload {
  type?: 'config';
  features?: FeatureDefinition[];
  collections?: Collection[];
  company_id?: string | number;
  timestamp?: number;
  restore_state?: RestoreState;
  voice_stack?: string;
  audio_dictation?: boolean;
  conversation_id?: string;
  avatar_enabled?: boolean;
}

export interface RestoreState {
  checkpoint?: string;
  data?: Record<string, unknown>;
  version?: number;
  updated_at?: string;
}

export interface ConfigAckPayload {
  acknowledged: boolean;
  timestamp: number;
  suppress_recap?: boolean;
}

export interface ConfigRequestPayload {
  requestedAt: number;
}

export interface SessionEndPayload {
  reason?: string;
  ended_at?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id?: string;
  parent_message_id?: string | null;
  scenario_version_id?: string;
  role: 'user' | 'assistant' | 'tool' | 'event' | string;
  content: string;
  timestamp: string;
  interrupted?: boolean;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  event_metadata?: Record<string, unknown>;
  experience_state?: Record<string, unknown>;
}

export interface PublicTokenRequest {
  external_id: string;
  scenario_uuid: string;
}

export interface PublicTokenResponse {
  user_token: string;
  user_id: number;
  application_id: number;
  external_id?: string;
  expires_in: number;
}

export interface SessionOptions {
  resumeConversationId?: string;
  experienceStateRecordingEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PublicSessionRequest {
  scenario_uuid: string;
  input_mode?: string;
  output_mode?: string;
  language?: string;
  metadata?: Record<string, unknown>;
  resume_conversation_id?: string;
  experience_state_recording_enabled?: boolean;
}

export interface PublicSessionResponse {
  livekit_token: string;
  livekit_url: string;
  expires_in: number;
}

export interface IdentityResponse {
  user_token: string;
  user_id: number;
  application_id: number;
  external_id?: string;
  expires_in?: number;
}
