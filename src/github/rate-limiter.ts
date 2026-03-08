export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;
  private rateLimitRemaining = Infinity;
  private rateLimitReset = 0;

  constructor(maxRequestsPerSecond: number) {
    this.maxTokens = maxRequestsPerSecond;
    this.tokens = maxRequestsPerSecond;
    this.refillRate = maxRequestsPerSecond;
    this.lastRefill = Date.now();
  }

  updateFromHeaders(remaining: number, reset: number): void {
    this.rateLimitRemaining = remaining;
    this.rateLimitReset = reset;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.rateLimitRemaining <= 5 && this.rateLimitReset > 0) {
      const waitMs = this.rateLimitReset * 1000 - Date.now();
      if (waitMs > 0 && waitMs < 60000) {
        await this.sleep(waitMs);
        this.rateLimitRemaining = Infinity;
      }
    }

    if (this.tokens < 1) {
      const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
      await this.sleep(waitMs);
      this.refill();
    }

    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
