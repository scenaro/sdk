import { describe, it, expect, vi } from "vitest";
import { ScenaroSession } from "./ScenaroSession";
import type {
  Transport,
  TransportDataMessage,
  TransportConnectionState,
} from "./transport";
import type { ScenaroClient } from "../client";

describe("frontend-controlled streaming animations", () => {
  it("controls activation, preserves raw scores, and rejects old or unauthenticated results", async () => {
    let receive: (m: TransportDataMessage) => void = () => {};
    let connection: (s: TransportConnectionState) => void = () => {};
    const callAgent = vi.fn(async (_method: string, raw: string) => {
      const p = JSON.parse(raw) as { activation_id: string };
      return JSON.stringify({ ok: true, activation_id: p.activation_id });
    });
    const transport: Transport = {
      callAgent,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      setMicrophoneEnabled: vi.fn(),
      sendText: vi.fn(),
      publishData: vi.fn(),
      registerToolHandler: () => {},
      unregisterToolHandler: () => {},
      onData: (h) => {
        receive = h;
        return () => {};
      },
      onConnectionStateChange: (h) => {
        connection = h;
        return () => {};
      },
      onAgentPresenceChange: () => () => {},
      onAgentStateChange: () => () => {},
      getEngineHandle: () => null,
    };
    const client = {
      identifyUser: vi.fn().mockResolvedValue({}),
      startSession: vi
        .fn()
        .mockResolvedValue({
          livekit_url: "wss://test",
          livekit_token: "test",
        }),
      request: vi.fn(),
    } as unknown as ScenaroClient;
    const session = new ScenaroSession({ client, transport });
    await session.start({
      scenario: "test",
      inputMode: "text",
      microphone: false,
    });
    const send = (topic: string, value: unknown, fromAgent = true) =>
      receive({
        topic,
        payload: new TextEncoder().encode(JSON.stringify(value)),
        fromAgent,
      });
    send("config", {
      features: [
        {
          name: "brief",
          type: "custom",
          settings: {
            animation: {
              schema_version: 1,
              key: "brief",
              questions: { price: { type: "noul", instructions: "Budget?" } },
              ui: { items: [] },
            },
          },
        },
      ],
    });
    expect(callAgent).not.toHaveBeenCalled();
    const results = vi.fn();
    session.on("animation-result", results);
    const id = await session.startAnimation("brief");
    const result = (sequence: number, noul: number, activation_id = id) => ({
      feature_key: "brief",
      activation_id,
      sequence,
      answers: { price: { type: "noul", noul } },
    });
    send("animation:result", result(1, 0.96), false);
    send("animation:result", result(1, 0.96));
    send("animation:result", result(2, 0.1));
    send("animation:result", result(1, 0.96));
    send("animation:result", result(3, 2));
    expect(results.mock.calls.map((c) => c[0].answers.price.noul)).toEqual([
      0.96, 0.1,
    ]);
    const next = await session.startAnimation("brief");
    await session.stopAnimation(id);
    expect(callAgent).toHaveBeenCalledTimes(2);
    send("animation:result", result(3, 0.96));
    expect(results).toHaveBeenCalledTimes(2);
    await session.stopAnimation(next);
    expect(JSON.parse(callAgent.mock.calls[2][1])).toMatchObject({
      active: false,
      activation_id: next,
    });
    connection("reconnecting");
    send("animation:result", result(4, 0.96, next));
    expect(results).toHaveBeenCalledTimes(2);
    session.destroy();
  });
});
