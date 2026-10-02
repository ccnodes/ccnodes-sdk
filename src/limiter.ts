/**
 * Client-side token bucket, shaped like the server's own: a steady rate plus a
 * burst allowance. The API's anonymous tier refills at 8 requests/s with a
 * 40-request burst (`burst = max(rate × 5, 40)`), so a page-load-sized burst
 * goes straight through and only sustained load is paced.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly queue: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
  ) {
    if (!(ratePerSec > 0)) throw new RangeError("ratePerSec must be > 0");
    this.tokens = capacity;
    this.last = Date.now();
  }

  /** Resolves when a token is available. FIFO. */
  take(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private refill(): void {
    const now = Date.now();
    const added = ((now - this.last) / 1000) * this.ratePerSec;
    if (added > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + added);
      this.last = now;
    }
  }

  private drain(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length > 0 && this.timer === null) {
      const waitMs = Math.max(5, ((1 - this.tokens) / this.ratePerSec) * 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
      // Never keep a Node process alive just to pace an abandoned queue.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }
}
