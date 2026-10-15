import { CollectionItemContextManager, type CollectionItemContext } from './collection-item-context';
import type { ScenaroClient, StorageAdapter } from '../client';
import { createScenaroClient, persistIdentity } from '../client';
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

export type ScenarioEventBehavior = 'silent' | 'sequential' | 'interrupt';

function makeClientEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toAgentState(raw: string | null): AgentState {
  return raw && KNOWN_AGENT_STATES.has(raw as AgentState) ? (raw as AgentState) : 'idle';
}

/**
 * Chrome expires transient user activation after ~5s and after network awaits.
 * Voice start must call getUserMedia *before* identify/session, or incognito
 * (no prior mic grant) fails with NotAllowedError and a generic session error.
 */
async function requestMicrophoneAccess(): Promise<void> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new ScenaroError('MIC_PERMISSION_DENIED', 'Microphone is not available in this browser');
  }
  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    throw new ScenaroError(
      'MIC_PERMISSION_DENIED',
      'Microphone permission is required for voice mode',
      error,
    );
  }
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
  private readonly itemContext: CollectionItemContextManager;
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
  private _suppressRecap = false;

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
    this.itemContext = new CollectionItemContextManager(this.client,(topic,data)=>this.transport.publishData(topic,data),error=>this.emitter.emit('error',new ScenaroError('CONNECTION_LOST','Item preloading failed',error)));
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
      suppressRecap = false,
      metadata,
      tools = {},
      connection,
    } = options;

    this._suppressRecap = suppressRecap;
    const wantsMicrophone = inputMode === 'audio' && microphone;
    if (wantsMicrophone) {
      await requestMicrophoneAccess();
    }

    this.setStatus('connecting');

    try {
      let livekitUrl: string;
      let livekitToken: string;

      if (connection?.livekitUrl && connection?.livekitToken) {
        livekitUrl = connection.livekitUrl;
        livekitToken = connection.livekitToken;
        if (connection.conversationId) {
          this._conversationId = connection.conversationId;
        }
        if (
          connection.userToken &&
          typeof connection.userId === 'number' &&
          typeof connection.applicationId === 'number' &&
          connection.applicationId > 0
        ) {
          persistIdentity(
            this.client.storage,
            this.client.keys,
            scenario,
            {
              user_token: connection.userToken,
              user_id: connection.userId,
              application_id: connection.applicationId,
              external_id: connection.externalId,
            },
            connection.externalId,
          );
        }
      } else {
        try {
          await this.client.identifyUser(scenario, externalId);
        } catch (error) {
          const scenaroError = new ScenaroError('IDENTIFY_FAILED', 'Failed to identify user', error);
          this.setStatus('idle');
          throw scenaroError;
        }

        const session = await this.client.startSession(scenario, {
          inputMode,
          outputMode,
          language,
          sessionOptions: { resumeConversationId, metadata },
        });

        if (!session?.livekit_url || !session?.livekit_token) {
          throw new ScenaroError(
            'SESSION_START_FAILED',
            'Session response missing livekit_url/livekit_token (expected POST /v1/public/session after identify)',
            session,
          );
        }
        livekitUrl = session.livekit_url;
        livekitToken = session.livekit_token;
      }

      // Re-registering a tool name without unregistering first throws at the transport level —
      // guard restart-after-end (or start() called twice) from crashing on stale registrations.
      this.unregisterTools();
      this.registerTools(tools);
      await this.transport.connect(livekitUrl, livekitToken);

      void this.transport.publishData(DATA_TOPICS.CONFIG_REQUEST, { requestedAt: Date.now() });

      if (wantsMicrophone) {
        try {
          await this.transport.setMicrophoneEnabled(true);
        } catch (error) {
          throw new ScenaroError(
            'MIC_PERMISSION_DENIED',
            'Microphone permission is required for voice mode',
            error,
          );
        }
      }

      this.setStatus('connected');
    } catch (error) {
      this.setStatus('idle');
      if (error instanceof ScenaroError) throw error;
      throw new ScenaroError('SESSION_START_FAILED', 'Failed to start session', error);
    }
  }

  async end(): Promise<void> {
    this.unregisterTools();
    await this.transport.disconnect();
    this.itemContext.clear();
    this.setStatus('ended');
  }

  /** Releases transport listeners and timers. Call when the owning provider unmounts. */
  destroy(): void {
    this.itemContext.clear();
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

  async fireEvent(options: {
    featureName: string;
    eventName: string;
    data?: Record<string, unknown>;
    behavior?: ScenarioEventBehavior;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      feature_name: options.featureName,
      event_name: options.eventName,
      data: options.data ?? {},
      fired_at: new Date().toISOString(),
      client_event_id: makeClientEventId('evt'),
    };
    if (options.behavior) payload.behavior = options.behavior;
    await this.guarded('CONNECTION_LOST', 'Failed to fire scenario event', () =>
      this.transport.publishData(DATA_TOPICS.EVENT_FIRE, payload),
    );
  }

  async updateCollectionItemContext(context: CollectionItemContext): Promise<void> {await this.itemContext.update(context)}

  async updateExperienceState(experienceState: Record<string, unknown>): Promise<void> {
    await this.guarded('CONNECTION_LOST', 'Failed to update experience state', () =>
      this.transport.publishData(DATA_TOPICS.STATE_UPDATE, {
        experience_state: experienceState,
        fired_at: new Date().toISOString(),
        client_event_id: makeClientEventId('state'),
      }),
    );
  }

  async setSessionControl(options: {
    discreteMode?: boolean;
    dictationMode?: boolean;
    manualAudio?: boolean;
    outputAudio?: boolean;
    listenOnly?: boolean;
    exchangeMode?: 'voice' | 'hybrid' | 'text' | 'audio_text';
    handoff?: 'mode_switch';
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      fired_at: new Date().toISOString(),
      client_event_id: makeClientEventId('session'),
    };
    if (options.discreteMode !== undefined) payload.discrete_mode = options.discreteMode;
    if (options.dictationMode !== undefined) payload.dictation_mode = options.dictationMode;
    if (options.manualAudio !== undefined) payload.manual_audio = options.manualAudio;
    if (options.outputAudio !== undefined) payload.output_audio = options.outputAudio;
    if (options.listenOnly !== undefined) payload.listen_only = options.listenOnly;
    if (options.exchangeMode !== undefined) payload.exchange_mode = options.exchangeMode;
    if (options.handoff !== undefined) payload.handoff = options.handoff;
    await this.guarded('CONNECTION_LOST', 'Failed to update session control', () =>
      this.transport.publishData(DATA_TOPICS.SESSION_CONTROL, payload),
    );
  }

  async interruptAssistant(): Promise<void> {
    await this.guarded('CONNECTION_LOST', 'Failed to interrupt assistant', () =>
      this.transport.publishData(DATA_TOPICS.ASSISTANT_INTERRUPT, {
        fired_at: new Date().toISOString(),
        client_event_id: makeClientEventId('interrupt'),
      }),
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
        if (state === 'disconnected' && (this._status === 'connected' || this._status === 'reconnecting')) {
          this._config = null;
          this._rawConfig = null;
          this.itemContext.clear();
    this.setStatus('ended');
          this.emitter.emit('session-end', { reason: 'transport_disconnected' });
        }
        if (state === 'reconnecting') this.setStatus('reconnecting');
        if (state === 'connected' && this._status === 'reconnecting') {
          this.setStatus('connected');
          void this.itemContext.resync().catch(error => this.emitter.emit('error', new ScenaroError('CONNECTION_LOST', 'Item resynchronization failed', error)));
          void this.transport.publishData(DATA_TOPICS.CONFIG_REQUEST, { requestedAt: Date.now() });
        }
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
      this.itemContext.clear();
    this.setStatus('ended');
      this.emitter.emit('session-end', { reason: 'agent_disconnected' });
    }, AGENT_DISCONNECT_GRACE_MS);
  }

  private handleDataMessage(topic: string, payload: Uint8Array): void {
    if (!topic) return;

    if (topic === 'items:ack') {const ack=this.decodeJson<{cached?:Record<string,string>;sequence?:number}>(payload);if(ack)this.itemContext.acknowledge(ack);return}
    if (topic === 'items:need') {const request=this.decodeJson<{collection_id?:number;collection_ids?:number[];ids:string[]}>(payload);if(request)void this.itemContext.need(request.ids,request.collection_ids??(request.collection_id?[request.collection_id]:undefined));return}
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
      this.itemContext.clear();
    this.setStatus('ended');
      this.emitter.emit('session-end', { reason: info.reason ?? 'shutdown' });
      return;
    }

    if (topic === DATA_TOPICS.CONFIG) {
      const rawConfig = this.decodeJson<ConfigPayload>(payload);
      if (!rawConfig) return;
      void this.transport.publishData(DATA_TOPICS.CONFIG_ACK, {
        acknowledged: true,
        timestamp: Date.now(),
        ...(this._suppressRecap ? { suppress_recap: true } : {}),
      });
      this._rawConfig = rawConfig;
      if(rawConfig.item_context?.enabled&&rawConfig.company_id)void this.itemContext.configure(rawConfig.company_id,rawConfig.item_context.collection_ids??(rawConfig.item_context.collection_id?[rawConfig.item_context.collection_id]:[])).catch(error=>this.emitter.emit('error',new ScenaroError('CONNECTION_LOST','Item synchronization failed',error)));
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
