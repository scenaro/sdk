/**
 * The only file in `@scenaro/sdk` allowed to import `livekit-client` directly (see
 * `no-restricted-imports` in `eslint.config.js`). `ScenaroSession`'s business logic never
 * touches LiveKit's API — it only calls the engine-agnostic `Transport` interface implemented
 * here. This keeps the door open for another engine (e.g. Pipecat) later without rewriting
 * `ScenaroSession`.
 */
import {
  ConnectionState,
  ParticipantKind,
  Room,
  RoomEvent,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';
import type {
  Transport,
  TransportConnectionState,
  TransportDataMessage,
  TransportToolRpcHandler,
} from '../../core/transport';

const AGENT_STATE_ATTRIBUTE = 'lk.agent.state';

function toTransportConnectionState(state: ConnectionState): TransportConnectionState {
  switch (state) {
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

function isAgentParticipant(participant: Participant): boolean {
  return participant.kind === ParticipantKind.AGENT;
}

export class LiveKitTransport implements Transport {
  private readonly room = new Room();

  async connect(url: string, token: string): Promise<void> {
    if (this.room.state !== 'disconnected') {
      await this.room.disconnect();
    }
    await this.room.connect(url, token);
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
  }

  async sendText(text: string): Promise<void> {
    await this.room.localParticipant.sendText(text, { topic: 'lk.chat' });
  }

  async publishData(topic: string, data: Record<string, unknown>): Promise<void> {
    const payload = new TextEncoder().encode(JSON.stringify(data));
    await this.room.localParticipant.publishData(payload, { topic, reliable:true });
  }

  registerToolHandler(name: string, handler: TransportToolRpcHandler): void {
    this.room.registerRpcMethod(name, async (data) => handler(data.payload));
  }

  unregisterToolHandler(name: string): void {
    try {
      this.room.unregisterRpcMethod(name);
    } catch {
      // not registered — ignore
    }
  }

  onData(handler: (message: TransportDataMessage) => void): () => void {
    const listener = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      handler({ topic: topic ?? '', payload });
    };
    this.room.on(RoomEvent.DataReceived, listener);
    return () => this.room.off(RoomEvent.DataReceived, listener);
  }

  onConnectionStateChange(handler: (state: TransportConnectionState) => void): () => void {
    const listener = (state: ConnectionState) => handler(toTransportConnectionState(state));
    this.room.on(RoomEvent.ConnectionStateChanged, listener);
    return () => this.room.off(RoomEvent.ConnectionStateChanged, listener);
  }

  onAgentPresenceChange(handler: (present: boolean) => void): () => void {
    const hasAgent = () =>
      Array.from(this.room.remoteParticipants.values()).some(isAgentParticipant);

    const onConnected = () => handler(hasAgent());
    const onDisconnected = () => handler(hasAgent());

    this.room.on(RoomEvent.ParticipantConnected, onConnected);
    this.room.on(RoomEvent.ParticipantDisconnected, onDisconnected);
    return () => {
      this.room.off(RoomEvent.ParticipantConnected, onConnected);
      this.room.off(RoomEvent.ParticipantDisconnected, onDisconnected);
    };
  }

  onAgentStateChange(handler: (state: string | null) => void): () => void {
    const listener = (_changed: Record<string, string>, participant: RemoteParticipant | LocalParticipant) => {
      if (!isAgentParticipant(participant)) return;
      handler(participant.attributes[AGENT_STATE_ATTRIBUTE] ?? null);
    };
    this.room.on(RoomEvent.ParticipantAttributesChanged, listener);
    return () => this.room.off(RoomEvent.ParticipantAttributesChanged, listener);
  }

  getEngineHandle(): Room {
    return this.room;
  }
}
