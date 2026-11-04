import type { ConfigPayload } from '../protocol';

export class ConfigAssembly {
  private pending?: {
    id: string;
    total: number;
    startedAt: number;
    parts: Map<number, string>;
  };

  clear(): void {
    this.pending = undefined;
  }

  add(value: unknown): ConfigPayload | null {
    if (!value || typeof value !== 'object') return null;
    const { id, index, total, part } = value as Record<string, unknown>;
    if (
      typeof id !== 'string' || !id || id.length > 64 ||
      typeof total !== 'number' || !Number.isInteger(total) || total < 2 || total > 350 ||
      typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= total ||
      typeof part !== 'string' || part.length > 24_000
    ) return null;

    const now = Date.now();
    if (this.pending?.id !== id || now - this.pending.startedAt > 30_000) {
      this.pending = { id, total, startedAt: now, parts: new Map() };
    }
    const pending = this.pending;
    if (pending.total !== total) return null;
    const previous = pending.parts.get(index);
    if (previous !== undefined && previous !== part) {
      this.clear();
      return null;
    }
    pending.parts.set(index, part);
    if (pending.parts.size !== total) return null;

    this.clear();
    try {
      const text = Array.from({ length: total }, (_, i) => pending.parts.get(i)).join('');
      const config = JSON.parse(text) as ConfigPayload | null;
      return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
    } catch {
      return null;
    }
  }
}
