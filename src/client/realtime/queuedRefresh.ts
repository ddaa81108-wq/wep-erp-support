/** Share active reads, but drain one fresh read if invalidated while loading. */
export class RefreshQueue {
  private pending: (() => Promise<void>) | null = null;
  private running: Promise<void> | null = null;
  get busy() { return this.running !== null; }
  private drain = async () => {
    try {
      while (this.pending) {
        const refresh = this.pending;
        this.pending = null;
        await refresh();
      }
    } finally {
      this.running = null;
    }
  };
  run(refresh: () => Promise<void>) {
    this.pending = refresh;
    this.running ??= Promise.resolve().then(this.drain);
    return this.running;
  }
}
