type EventHandler = (data: Record<string, unknown>) => void;

export class ScenaroEventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, data: Record<string, unknown> = {}): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[ScenaroEventBus] handler error for "${event}":`, error);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
