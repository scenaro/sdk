type Args<TEvents, K extends keyof TEvents> = TEvents[K] extends (...args: infer A) => void ? A : never;

/** Minimal typed pub/sub used by `ScenaroSession`. Keys are the kebab-case event names. */
export class TypedEmitter<TEvents> {
  private listeners = new Map<keyof TEvents, Set<(...args: never[]) => void>>();

  on<K extends keyof TEvents>(event: K, handler: TEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: never[]) => void);
  }

  off<K extends keyof TEvents>(event: K, handler: TEvents[K]): void {
    this.listeners.get(event)?.delete(handler as (...args: never[]) => void);
  }

  emit<K extends keyof TEvents>(event: K, ...args: Args<TEvents, K>): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        (handler as (...args: unknown[]) => void)(...args);
      } catch (error) {
        console.error(`[ScenaroSession] listener error for "${String(event)}":`, error);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
