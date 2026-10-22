/** Shares only concurrent reads. Mutations and session changes start a new generation. */
export class PendingReads {
  private pending = new Map<string, Promise<unknown>>();

  clear() {
    this.pending.clear();
  }

  run<T>(key: string, read: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const flight = read().finally(() => {
      if (this.pending.get(key) === flight) this.pending.delete(key);
    });
    this.pending.set(key, flight);
    return flight;
  }
}
