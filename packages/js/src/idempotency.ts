/**
 * Providers retry webhooks (Paystack for up to 72 h), so the same event can arrive several times.
 * Implement this interface on top of Redis/Postgres/etc. in production — see docs/idempotency.md for recipes.
 */
export interface IdempotencyStore {
  /**
   * Atomically record `id` if unseen. Return `true` if it was newly recorded, `false` if it was already present.
   * (With Redis: `SET key 1 NX EX ttl`. With Postgres: `INSERT ... ON CONFLICT DO NOTHING`.)
   */
  claim(id: string, ttlSeconds: number): Promise<boolean> | boolean;
  /** Optional: release a claim when processing failed, so the provider's retry can be processed. */
  release?(id: string): Promise<void> | void;
}

/** In-memory store — for development and tests only (not shared across processes, lost on restart). */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #seen = new Map<string, number>();
  readonly #max: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.#max = options.maxEntries ?? 10_000;
  }

  claim(id: string, ttlSeconds: number): boolean {
    const now = Date.now();
    const expires = this.#seen.get(id);
    if (expires !== undefined && expires > now) return false;
    if (this.#seen.size >= this.#max) {
      for (const [k, exp] of this.#seen) {
        if (exp <= now || this.#seen.size >= this.#max) this.#seen.delete(k);
        if (this.#seen.size < this.#max) break;
      }
    }
    this.#seen.set(id, now + ttlSeconds * 1000);
    return true;
  }

  release(id: string): void {
    this.#seen.delete(id);
  }
}
