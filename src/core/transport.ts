/**
 * Internal, non-public boundary between `ScenaroSession`'s business logic and the real-time
 * engine that carries it (LiveKit today, potentially another engine — e.g. Pipecat — later).
 * `ScenaroSession` only talks to this interface; engine-specific code lives in `src/transport/*`.
 */

export type TransportConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface TransportDataMessage {
  topic: string;
  payload: Uint8Array;
}

export type TransportToolRpcHandler = (payload: string) => Promise<string>;

export interface Transport {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  sendText(text: string): Promise<void>;
  publishData(topic: string, data: Record<string, unknown>): Promise<void>;
  registerToolHandler(name: string, handler: TransportToolRpcHandler): void;
  unregisterToolHandler(name: string): void;
  onData(handler: (message: TransportDataMessage) => void): () => void;
  onConnectionStateChange(handler: (state: TransportConnectionState) => void): () => void;
  onAgentPresenceChange(handler: (present: boolean) => void): () => void;
  onAgentStateChange(handler: (state: string | null) => void): () => void;
  /** Non-portable escape hatch: the underlying engine object (e.g. LiveKit's `Room`). */
  getEngineHandle(): unknown;
}
