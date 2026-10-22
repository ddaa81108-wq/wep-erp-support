/** Short-lived presentation snapshots. Every screen still validates with the server. */
export class SectionSnapshots {
  generation = 0;
  private entries = new Map<string, { value: unknown; expires: number }>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return;
    }
    return entry.value as T;
  }
  set<T>(key: string, value: T, generation = this.generation) {
    if (generation !== this.generation) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + 30_000 });
    while (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!);
  }
  clear() { this.generation++; this.entries.clear(); }
}
