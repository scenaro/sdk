import type { ScenaroClient, StorageAdapter } from '../client';
import { createScenaroClient } from '../client';
import {
  DATA_TOPICS,
  RPC_TIMEOUTS,
  resolveRpcMethodName,
  type ConfigPayload,
  type ConversationMessage,
} from '../protocol';
import { LiveKitTransport } from '../transport/livekit';
import { TypedEmitter } from './emitter';
import { ScenaroError, type ScenaroErrorCode } from './errors';
import type { Transport } from './transport';
import type {
  AgentState,
  ScenaroSessionEvents,
  SessionConfig,
  SessionStatus,
  StartSessionOptions,
  ToolContext,
  ToolHandler,
} from './types';

const AGENT_DISCONNECT_GRACE_MS = 2000;

const KNOWN_AGENT_STATES = new Set<AgentState>(['idle', 'listening', 'thinking', 'speaking']);

function toAgentState(raw: string | null): AgentState {
  return raw && KNOWN_AGENT_STATES.has(raw as AgentState) ? (raw as AgentState) : 'idle';
}

function findToolSettings(rawConfig: ConfigPayload | null, toolName: string): Record<string, unknown> {
  for (const feature of rawConfig?.features ?? []) {
    const tool = feature.tools?.find((t) => resolveRpcMethodName(t) === toolName);
    if (tool) return tool.settings ?? feature.settings ?? {};
  }
  return {};
}

/**
 * The wire payload carries backend/transport plumbing (`company_id`, `voice_stack`,
 * `timestamp`, the `tools` wiring inside each feature…) that tool resolution needs
 * internally but that has no business being public API. `config` on the session only
 * ever exposes this curated view — see `SessionConfig` in `./types`.
 */
function toPublicConfig(rawConfig: ConfigPayload): SessionConfig {
  return {
    features: (rawConfig.features ?? []).map((feature) => ({
      name: feature.name,
      type: feature.type,
      settings: feature.settings ?? {},
    })),
    collections: rawConfig.collections ?? [],
    avatarEnabled: rawConfig.avatar_enabled ?? false,
    audioDictationEnabled: rawConfig.audio_dictation ?? false,
  };
}

export interface ScenaroSessionOptions {
  client?: ScenaroClient;
  apiUrl?: string;
  apiPathPrefix?: string;
  storage?: StorageAdapter | null;
  storagePrefix?: string;
  /** Injectable for tests; defaults to the LiveKit transport. */
  transport?: Transport;
}

export class ScenaroSession {
  private readonly client: ScenaroClient;
  private readonly transport: Transport;
  private readonly emitter = new TypedEmitter<ScenaroSessionEvents>();
  private readonly registeredTools = new Set<string>();
  private readonly transportUnsubscribers: Array<() => void> = [];
  private agentDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private _status: SessionStatus = 'idle';
  private _agentState: AgentState = 'idle';
  private _messages: ConversationMessage[] = [];
  private _config: SessionConfig | null = null;
  /** Wire payload backing `_config` — kept for tool-context resolution only, never exposed publicly. */
  private _rawConfig: ConfigPayload | null = null;
  private _conversationId: string | null = null;

  constructor(options: ScenaroSessionOptions = {}) {
    if (!options.client && !options.apiUrl) {
      throw new Error('ScenaroSession requires either `client` or `apiUrl`');
    }
    this.client =
      options.client ??
      createScenaroClient({
        apiUrl: options.apiUrl ?? '',
        apiPathPrefix: options.apiPathPrefix,
        storage: options.storage,
        storagePrefix: options.storagePrefix,
      });
    this.transport = options.transport ?? new LiveKitTransport();
    this.bindTransport();
  }

  get status(): SessionStatus {
    return this._status;
  }

  get agentState(): AgentState {
    return this._agentState;
  }

  get messages(): ConversationMessage[] {
    return this._messages;
  }

  get config(): SessionConfig | null {
    return this._config;
  }

  get conversationId(): string | null {
    return this._conversationId;
  }

  /** Wire-format config payload — for apps that need restore_state, tool wiring, etc. */
  get rawConfig(): ConfigPayload | null {
    return this._rawConfig;
  }

  /** Extension LiveKit — non-portable, see docs/guides/advanced-livekit-integration. */
  get room(): unknown {
    return this.transport.getEngineHandle();
  }

  on<K extends keyof ScenaroSessionEvents>(event: K, handler: ScenaroSessionEvents[K]): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof ScenaroSessionEvents>(event: K, handler: ScenaroSessionEvents[K]): void {
    this.emitter.off(event, handler);
  }

  async start(options: StartSessionOptions): Promise<void> {
    const {
      scenario,
      language,
      inputMode = 'audio',
      outputMode = 'audio',
      microphone = true,
      externalId = null,
      resumeConversationId,
      metadata,
      tools = {},
    } = options;

    this.setStatus('connecting');

    try {
      await this.client.identifyUser(scenario, externalId);
    } catch (error) {
      const scenaroError = new ScenaroError('IDENTIFY_FAILED', 'Failed to identify user', error);
      this.setStatus('idle');
      throw scenaroError;
    }

    try {
      const session = await this.client.startSession(scenario, {
        inputMode,
        outputMode,
        language,
        sessionOptions: { resumeConversationId, metadata },
      });

      // Re-registering a tool name without unregistering first throws at the transport level —
      // guard restart-after-end (or start() called twice) from crashing on stale registrations.
      this.unregisterTools();
      this.registerTools(tools);
      await this.transport.connect(session.livekit_url, session.livekit_token);

      void this.transport.publishData(DATA_TOPICS.CONFIG_REQUEST, { requestedAt: Date.now() });

      if (inputMode === 'audio' && microphone) {
        await this.transport.setMicrophoneEnabled(true);
      }

      this.setStatus('connected');
    } catch (error) {
      this.setStatus('idle');
      throw new ScenaroError('SESSION_START_FAILED', 'Failed to start session', error);
    }
  }

  async end(): Promise<void> {
    this.unregisterTools();
    await this.transport.disconnect();
    this.setStatus('ended');
  }

  /** Releases transport listeners and timers. Call when the owning provider unmounts. */
  destroy(): void {
    this.transportUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.transportUnsubscribers.length = 0;
    if (this.agentDisconnectTimer) {
      clearTimeout(this.agentDisconnectTimer);
      this.agentDisconnectTimer = null;
    }
    this.unregisterTools();
    void this.transport.disconnect();
  }

  async sendText(text: string): Promise<void> {
    await this.guarded('CONNECTION_LOST', 'Failed to send text message', () => this.transport.sendText(text));
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.guarded('MIC_PERMISSION_DENIED', 'Failed to toggle microphone', () =>
      this.transport.setMicrophoneEnabled(enabled),
    );
  }

  /**
   * Runs a transport call that happens *during* an active session (as opposed to `start()`,
   * which throws on failure). Per the error contract, these never throw — they emit `on('error')`
   * so a failed `setMicrophoneEnabled()` etc. doesn't produce an unhandled rejection in fire-and-forget
   * call sites.
   */
  private async guarded(code: ScenaroErrorCode, message: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.emitter.emit('error', new ScenaroError(code, message, error));
    }
  }

  private setStatus(status: SessionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.emitter.emit('status-change', status);
  }

  private setAgentState(state: AgentState): void {
    if (this._agentState === state) return;
    this._agentState = state;
    this.emitter.emit('agent-state', state);
  }

  private registerTools(tools: Record<string, ToolHandler>): void {
    for (const [name, handler] of Object.entries(tools)) {
      this.transport.registerToolHandler(name, (payload) => this.runTool(name, handler, payload));
      this.registeredTools.add(name);
    }
  }

  private unregisterTools(): void {
    this.registeredTools.forEach((name) => this.transport.unregisterToolHandler(name));
    this.registeredTools.clear();
  }

  private async runTool(name: string, handler: ToolHandler, rawPayload: string): Promise<string> {
    let requestId = '';
    try {
      const { requestId: id, args = {} } = JSON.parse(rawPayload) as {
        requestId: string;
        args?: Record<string, unknown>;
      };
      requestId = id;

      const controller = new AbortController();
      const context: ToolContext = {
        toolName: name,
        settings: findToolSettings(this._rawConfig, name),
        collections: this._rawConfig?.collections ?? [],
        signal: controller.signal,
      };

      const outcome = await this.runWithTimeout(
        Promise.resolve(handler(args, context)),
        RPC_TIMEOUTS.FRONTEND_TOOL_MS,
        controller,
      );

      if (outcome.timedOut) {
        return JSON.stringify({ requestId, code: 'TIMEOUT', data: { toolName: name } });
      }
      return JSON.stringify({ requestId, code: 'SUCCESS', data: outcome.value });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      return JSON.stringify({ requestId, code: 'ERROR', data: { error: message, toolName: name } });
    }
  }

  /**
   * `signal` is aborted when the timeout fires so a well-behaved handler can stop early, but the
   * RPC response to the agent is what actually needs to resolve on time — a handler that ignores
   * the signal must not hang the tool call forever.
   */
  private runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    controller: AbortController,
  ): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve({ timedOut: true });
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve({ timedOut: false, value });
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private bindTransport(): void {
    this.transportUnsubscribers.push(
      this.transport.onData((message) => this.handleDataMessage(message.topic, message.payload)),
      this.transport.onAgentStateChange((raw) => this.setAgentState(toAgentState(raw))),
      this.transport.onAgentPresenceChange((present) => this.handleAgentPresenceChange(present)),
      this.transport.onConnectionStateChange((state) => {
        if (state === 'disconnected' && this._status === 'connected') {
          this._config = null;
          this._rawConfig = null;
          this.setStatus('ended');
          this.emitter.emit('session-end', { reason: 'transport_disconnected' });
        }
        if (state === 'reconnecting') this.setStatus('reconnecting');
      }),
    );
  }

  private handleAgentPresenceChange(present: boolean): void {
    if (this.agentDisconnectTimer) {
      clearTimeout(this.agentDisconnectTimer);
      this.agentDisconnectTimer = null;
    }
    if (present || this._status !== 'connected') return;

    this.agentDisconnectTimer = setTimeout(() => {
      this.agentDisconnectTimer = null;
      if (this._status !== 'connected') return;
      this.setStatus('ended');
      this.emitter.emit('session-end', { reason: 'agent_disconnected' });
    }, AGENT_DISCONNECT_GRACE_MS);
  }

  private handleDataMessage(topic: string, payload: Uint8Array): void {
    if (!topic) return;

    if (topic === DATA_TOPICS.MESSAGE_NEW) {
      const message = this.decodeJson<ConversationMessage>(payload);
      if (!message) return;
      this._messages = [...this._messages, message];
      if (message.conversation_id) this._conversationId = message.conversation_id;
      this.emitter.emit('message', message);
      return;
    }

    if (topic === DATA_TOPICS.SESSION_END) {
      const info = this.decodeJson<{ reason?: string }>(payload) ?? {};
      this.setStatus('ended');
      this.emitter.emit('session-end', { reason: info.reason ?? 'shutdown' });
      return;
    }

    if (topic === DATA_TOPICS.CONFIG) {
      const rawConfig = this.decodeJson<ConfigPayload>(payload);
      if (!rawConfig) return;
      void this.transport.publishData(DATA_TOPICS.CONFIG_ACK, { acknowledged: true, timestamp: Date.now() });
      this._rawConfig = rawConfig;
      this._config = toPublicConfig(rawConfig);
      if (rawConfig.conversation_id) this._conversationId = rawConfig.conversation_id;
      this.emitter.emit('config', this._config);
    }
  }

  private decodeJson<T>(payload: Uint8Array): T | null {
    try {
      return JSON.parse(new TextDecoder('utf-8').decode(payload)) as T;
    } catch {
      return null;
    }
  }
}
