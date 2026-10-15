import type { Collection, ConversationMessage } from '../protocol';
import type { ScenaroError } from './errors';

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Public UI metadata for a feature — the `tools` it registers are wiring detail, not exposed here. */
export interface SessionFeature {
  name: string | Record<string, string>;
  type: string;
  settings: Record<string, unknown>;
}

/**
 * Curated, portable view of the scenario config — not a passthrough of the wire payload.
 * Fields like `company_id`, `voice_stack`, or `timestamp` are backend/transport plumbing and
 * are deliberately left out; they never had a reason to be public API.
 */
export interface SessionConfig {
  features: SessionFeature[];
  collections: Collection[];
  avatarEnabled: boolean;
  audioDictationEnabled: boolean;
}

export interface ToolContext {
  toolName: string;
  settings: Record<string, unknown>;
  collections: Collection[];
  signal: AbortSignal;
}

export type ToolHandler<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> = (args: TArgs, context: ToolContext) => TResult | Promise<TResult>;

export interface StartSessionOptions {
  scenario: string;
  language?: string;
  inputMode?: 'audio' | 'text';
  outputMode?: 'audio' | 'text';
  microphone?: boolean;
  externalId?: string | null;
  resumeConversationId?: string;
  /** Mode-switch reconnect: the next config ack asks the agent not to treat this as a return. */
  suppressRecap?: boolean;
  metadata?: Record<string, unknown>;
  tools?: Record<string, ToolHandler>;
  /**
   * Backend-minted Transport credentials. When set, `start()` skips
   * `identifyUser` + `POST /public/session` and connects directly.
   * Use after your server called `/applications/:id/token` (+ optional
   * `/public/session`) — never put an application API key in the client.
   */
  connection?: SessionConnectionCredentials;
}

/** LiveKit (Transport) credentials minted server-side. */
export interface SessionConnectionCredentials {
  livekitUrl: string;
  livekitToken: string;
  /** Optional Scenaro user JWT for subsequent public API calls. */
  userToken?: string;
  conversationId?: string;
  /** Scenaro user id — with applicationId, enables persistIdentity. */
  userId?: number;
  /** Scenaro application id — required to store identity under the app key. */
  applicationId?: number;
  externalId?: string;
}

export interface SessionEndInfo {
  reason: string;
}

export interface ScenaroSessionEvents {
  'status-change': (status: SessionStatus) => void;
  'agent-state': (state: AgentState) => void;
  message: (message: ConversationMessage) => void;
  config: (config: SessionConfig) => void;
  'session-end': (info: SessionEndInfo) => void;
  error: (error: ScenaroError) => void;
}
