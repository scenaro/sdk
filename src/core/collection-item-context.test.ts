import { describe, it, expect, vi } from "vitest";
import { CollectionItemContextBridge } from "./collection-item-context";
import { ScenaroSession } from "./ScenaroSession";
import type { Transport, TransportDataMessage, TransportConnectionState } from "./transport";
import type { ScenaroClient } from "../client";
const packet = {
  payload: btoa(
    JSON.stringify({ revision: "r1", expires_at: Date.now() / 1000 + 3600 }),
  ),
  signature: "opaque",
};
const item = { id: "a", collection_id: 12, agent_item: packet };
describe("collection navigation context", () => {
  it("available is distinct from visible; accepted data is not resent on navigation", async () => {
    const request = vi.fn(),
      publish = vi.fn().mockResolvedValue(undefined);
    const bridge = new CollectionItemContextBridge(
      { request } as unknown as ScenaroClient,
      publish,
      () => {},
    );
    await bridge.update({
      collectionId: 12,
      items: [item, { id: "b", collection_id: 12 }],
    });
    await bridge.configure(7, 12);
    expect(request).not.toHaveBeenCalled();
    expect(publish.mock.calls.some((c) => c[1].packets)).toBe(false);
    await bridge.update({ collectionId: 12, visible: ["a"] });
    expect(publish.mock.calls.filter((c) => c[1].packets)).toHaveLength(1);
    bridge.acknowledge({ cached: { a: "r1" } });
    await bridge.update({ collectionId: 12, visible: [], used: ["a"] });
    expect(publish.mock.calls.filter((c) => c[1].packets)).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
    expect(
      publish.mock.calls[publish.mock.calls.length - 1]?.[1].state.visible,
    ).toEqual([]);
  });
  it("reloads missing data and resends cached packets on reconnect", async () => {
    const request = vi.fn().mockResolvedValue(item),
      publish = vi.fn().mockResolvedValue(undefined);
    const bridge = new CollectionItemContextBridge(
      { request } as unknown as ScenaroClient,
      publish,
      () => {},
    );
    await bridge.configure(7, 12);
    await bridge.update({ collectionId: 12, visible: ["a"] });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][1]).toEqual({
      query: { agent_context: true },
    });
    bridge.acknowledge({ cached: { a: "r1" } });
    await bridge.resync();
    expect(publish.mock.calls.filter((c) => c[1].packets)).toHaveLength(2);
    expect(request).toHaveBeenCalledOnce();
  });
  it("rejects cross-collection data without sending it", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const bridge = new CollectionItemContextBridge(
      { request: vi.fn() } as unknown as ScenaroClient,
      publish,
      () => {},
    );
    await bridge.configure(7, 12);
    await expect(
      bridge.update({ collectionId: 13, visible: ["a"] }),
    ).rejects.toThrow("outside");
  });
  it("fragments large packets without copying them into experience state", async () => {
    const large = { ...packet, signature: "x".repeat(25000) };
    const publish = vi.fn().mockResolvedValue(undefined);
    const bridge = new CollectionItemContextBridge(
      { request: vi.fn() } as unknown as ScenaroClient,
      publish,
      () => {},
    );
    await bridge.configure(7, 12);
    await bridge.update({
      collectionId: 12,
      items: [{ ...item, agent_item: large }],
      visible: ["a"],
    });
    expect(publish.mock.calls.filter((c) => c[1].chunk).length).toBeGreaterThan(
      1,
    );
    expect(publish.mock.calls.every((c) => c[0] === "items:sync")).toBe(true);
    expect(
      publish.mock.calls.find((c) => c[1].state)?.[1].state,
    ).not.toHaveProperty("packets");
  });
});


it("session reconnect restores active item packets and requests fresh configuration", async () => {
 let connection: (state:TransportConnectionState)=>void = () => {};
 let data: (message:TransportDataMessage)=>void = () => {};
 const publish=vi.fn().mockResolvedValue(undefined);
 const transport:Transport={connect:vi.fn().mockResolvedValue(undefined),disconnect:vi.fn().mockResolvedValue(undefined),setMicrophoneEnabled:vi.fn().mockResolvedValue(undefined),sendText:vi.fn().mockResolvedValue(undefined),publishData:publish,registerToolHandler:()=>{},unregisterToolHandler:()=>{},onData:h=>{data=h;return()=>{}},onConnectionStateChange:h=>{connection=h;return()=>{}},onAgentPresenceChange:()=>()=>{},onAgentStateChange:()=>()=>{},getEngineHandle:()=>null};
 const client={identifyUser:vi.fn().mockResolvedValue({}),startSession:vi.fn().mockResolvedValue({livekit_url:'wss://test',livekit_token:'test'}),request:vi.fn()} as unknown as ScenaroClient;
 const session=new ScenaroSession({client,transport});
 await session.start({scenario:'test',inputMode:'text',microphone:false});
 const receive=(topic:string,payload:unknown)=>data({topic,payload:new TextEncoder().encode(JSON.stringify(payload))});
 receive('config',{company_id:7,item_context:{enabled:true,collection_id:12},features:[],collections:[]});
 await session.updateCollectionItemContext({collectionId:12,items:[item],visible:['a']});
 receive('items:ack',{cached:{a:'r1'}});publish.mockClear();
 connection('reconnecting');expect(session.status).toBe('reconnecting');connection('connected');
 await vi.waitFor(()=>expect(publish.mock.calls.some(c=>c[1].packets)).toBe(true));
 expect(session.status).toBe('connected');expect(publish.mock.calls.some(c=>c[0]==='config_request')).toBe(true);
 session.destroy();
});

it('keeps independent collection navigation and only preloads referenced collections', async()=>{
 const {CollectionItemContextManager}=await import('./collection-item-context');
 const sent:any[]=[];
 const manager=new CollectionItemContextManager({request:vi.fn()} as any,async(topic,data)=>{sent.push({topic,...data})},()=>{});
 await manager.update({collectionId:12,items:[item],visible:[]});
 await manager.configure(7,[12,13]);
 await manager.update({collectionId:13,items:[{id:'c',collection_id:13,agent_item:packet}],visible:[]});
 await manager.update({collectionId:14,items:[{id:'x',collection_id:14}],visible:['x']});
 const states=sent.filter(s=>s.state).map(s=>s.state);
 expect(states.map(s=>s.collection_id)).toEqual([12,13,13]);
 expect(states.find(s=>s.collection_id===12).available).toEqual([{id:'a'}]);
 expect(states[states.length-1].available).toEqual([{id:'c'}]);
});
