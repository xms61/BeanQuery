/**
 * Counts attempts per client in fixed windows, in memory only: the client keys (addresses) are never written to the
 * database or the logs, and a restart forgets them. Enough for an invite-only app on one process.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt. False when the client has used up the window and must wait. */
  attempt(key: string, now: Date): boolean {
    const time = now.getTime();
    if (this.windows.size > 10_000) this.forgetExpired(time);
    const window = this.windows.get(key);
    if (window === undefined || time - window.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: time, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.max;
  }

  private forgetExpired(time: number): void {
    for (const [key, window] of this.windows) {
      if (time - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
