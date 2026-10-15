import type { ScenaroClient } from "../client";

export interface AgentItemEnvelope {
  payload: string;
  signature: string;
}
export interface ContextCollectionItem {
  id: string;
  collection_id: number;
  agent_item?: AgentItemEnvelope;
  [key: string]: unknown;
}
export interface CollectionItemContext {
  collectionId: number;
  items?: ContextCollectionItem[];
  visible?: string[];
  selected?: string[];
  used?: string[];
  prefetch?: string[];
}
interface Ack {
  cached?: Record<string, string>;
  sequence?: number;
}
/** Navigation references and sealed data are separate from conversation/state recording. */
export class CollectionItemContextBridge {
  private collectionId: number | null = null;
  private companyId: number | string | null = null;
  private sequence = 0;
  private index = new Map<string, ContextCollectionItem>();
  private accepted = new Map<string, string>();
  private inflight = new Map<string, Promise<void>>();
  private visible: string[] = [];
  private selected: string[] = [];
  private used: string[] = [];
  private generation = 0;
  constructor(
    private client: ScenaroClient,
    private publish: (
      topic: string,
      data: Record<string, unknown>,
    ) => Promise<void>,
    private onError: (error: unknown) => void,
  ) {}
  async configure(companyId: number | string, collectionId: number) {
    if (this.collectionId !== null && this.collectionId !== collectionId)
      this.clear();
    this.companyId = companyId;
    this.collectionId = collectionId;
    this.accepted.clear();
    await this.sync();
    await this.preload([...this.selected, ...this.used, ...this.visible]);
  }
  async update(context: CollectionItemContext) {
    if (
      this.collectionId !== null &&
      this.collectionId !== context.collectionId
    )
      throw new Error("Collection outside session context");
    if (this.collectionId === null) this.collectionId = context.collectionId;
    for (const item of context.items ?? []) {
      if (item.collection_id !== context.collectionId)
        throw new Error("Item outside collection");
      this.index.set(String(item.id), item);
    }
    if (context.visible)
      this.visible = Array.from(new Set(context.visible)).slice(0, 100);
    if (context.selected)
      this.selected = Array.from(new Set(context.selected)).slice(0, 32);
    if (context.used)
      this.used = Array.from(new Set(context.used)).slice(0, 32);
    while (this.index.size > 512) {
      const victim = [...this.index.keys()].find(
        (id) => ![...this.visible, ...this.selected, ...this.used].includes(id),
      );
      if (!victim) break;
      this.index.delete(victim);
    }
    this.generation++;
    if (this.companyId === null) return;
    await this.sync();
    await this.preload([
      ...this.selected,
      ...this.used,
      ...this.visible,
      ...(context.prefetch ?? []).slice(0, 4),
    ]);
  }
  async resync() {
    this.accepted.clear();
    if (this.companyId !== null) {
      await this.sync();
      await this.preload([...this.selected, ...this.used, ...this.visible]);
    }
  }
  private async sync() {
    if (this.collectionId === null || this.companyId === null) return;
    await this.publish("items:sync", {
      state: {
        collection_id: this.collectionId,
        sequence: ++this.sequence,
        available: [...this.index.keys()].map((id) => ({ id })),
        visible: this.visible,
        selected: this.selected,
        used: this.used,
      },
    });
  }
  acknowledge(ack: Ack) {
    this.accepted = new Map(Object.entries(ack.cached ?? {}));
    if (typeof ack.sequence === "number")
      this.sequence = Math.max(this.sequence, ack.sequence);
  }
  async need(ids: string[]) {
    for (const id of ids) {
      this.accepted.delete(id);
      const item = this.index.get(id);
      if (item) this.index.set(id, { ...item, agent_item: undefined });
    }
    await this.preload(ids.filter(id=>this.index.has(id)).slice(0, 32));
  }
  private revision(packet: AgentItemEnvelope): string {
    const p = JSON.parse(atob(packet.payload));
    return String(p.revision);
  }
  private async preload(ids: string[]) {
    const unique = Array.from(new Set(ids)).slice(0, 32);
    const generation = this.generation;
    // At most three HTTP reads at once; stale speculative jobs are abandoned.
    const jobs = unique.slice();
    const worker = async () => {
      while (jobs.length) {
        const id = jobs.shift()!;
        if (
          generation !== this.generation &&
          !this.visible.includes(id) &&
          !this.selected.includes(id) &&
          !this.used.includes(id)
        )
          continue;
        await this.load(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  }
  private async load(id: string) {
    if (this.inflight.has(id)) return this.inflight.get(id)!;
    const task = (async () => {
      let item = this.index.get(id);
      let packet = item?.agent_item;
      if (packet) {
        const p = JSON.parse(atob(packet.payload));
        if (p.expires_at * 1000 <= Date.now() + 30000) packet = undefined;
      }
      if (packet && this.accepted.get(id) === this.revision(packet)) return;
      if (!packet) {
        item = await this.client.request<ContextCollectionItem>(
          `/public/companies/${this.companyId}/collections/${this.collectionId}/items/${encodeURIComponent(id)}`,
          { query: { agent_context: true } },
        );
        if (!item.agent_item) throw new Error("Verified item envelope missing");
        if (String(item.id) !== id || item.collection_id !== this.collectionId)
          throw new Error("Item response outside scope");
        this.index.set(id, item);
        packet = item.agent_item;
      }
      const text = JSON.stringify(packet);
      if (text.length > 400000) throw new Error("Item packet too large");
      if (text.length <= 10000) {
        await this.publish("items:sync", { packets: [packet] });
        return;
      }
      const key = `${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const total = Math.ceil(text.length / 10000);
      for (let part = 0; part < total; part++)
        await this.publish("items:sync", {
          chunk: {
            id: key,
            part,
            total,
            data: text.slice(part * 10000, (part + 1) * 10000),
          },
        });
    })();
    this.inflight.set(id, task);
    try {
      await task;
    } catch (e) {
      this.onError(e);
    } finally {
      this.inflight.delete(id);
    }
  }
  clear() {
    this.generation++;
    this.collectionId = null;
    this.companyId = null;
    this.index.clear();
    this.accepted.clear();
    this.visible = [];
    this.selected = [];
    this.used = [];
    this.sequence = 0;
  }
}

/** One bridge per referenced collection; navigation remains collection-scoped. */
export class CollectionItemContextManager {
 private bridges=new Map<number,CollectionItemContextBridge>();
 private allowed:number[]|null=null;
 private company:number|string|null=null;
 constructor(private client:ScenaroClient,private publish:(topic:string,data:Record<string,unknown>)=>Promise<void>,private onError:(error:unknown)=>void){}
 private bridge(id:number) {
  let bridge=this.bridges.get(id);
  if(!bridge){bridge=new CollectionItemContextBridge(this.client,this.publish,this.onError);this.bridges.set(id,bridge)}
  return bridge;
 }
 async configure(company:number|string,ids:number[]) {
  this.company=company;this.allowed=ids;
  for(const [id,b] of this.bridges)if(!ids.includes(id)){b.clear();this.bridges.delete(id)}
  await Promise.all(ids.map(id=>this.bridge(id).configure(company,id)));
 }
 async update(context:CollectionItemContext) {
  if(this.allowed&&!this.allowed.includes(context.collectionId))return;
  await this.bridge(context.collectionId).update(context);
 }
 acknowledge(ack:Ack){for(const b of this.bridges.values())b.acknowledge(ack)}
 async need(ids:string[],collections?:number[]){await Promise.all((collections??this.allowed??[]).map(id=>this.bridges.get(id)?.need(ids)))}
 async resync(){await Promise.all([...this.bridges.values()].map(b=>b.resync()))}
 clear(){for(const b of this.bridges.values())b.clear();this.bridges.clear();this.allowed=null;this.company=null}
}
