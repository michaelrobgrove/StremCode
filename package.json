/**
 * StremCodes - Rate Limiter
 * Uses Cloudflare KV for distributed rate limiting
 */

export class RateLimiter {
  constructor(kv) {
    this.kv = kv;
  }

  /**
   * Check if request is within rate limit
   * @param {string} key - unique identifier (e.g. "validate:1.2.3.4")
   * @param {number} limit - max requests per window
   * @param {number} windowSecs - window size in seconds
   * @returns {boolean} true if allowed, false if rate limited
   */
  async check(key, limit, windowSecs) {
    try {
      const kvKey = `rl:${key}`;
      const now = Math.floor(Date.now() / 1000);
      const windowKey = `${kvKey}:${Math.floor(now / windowSecs)}`;

      const current = await this.kv.get(windowKey);
      const count = current ? parseInt(current) : 0;

      if (count >= limit) return false;

      await this.kv.put(windowKey, String(count + 1), {
        expirationTtl: windowSecs * 2,
      });

      return true;
    } catch {
      // If KV fails, allow the request (fail open)
      return true;
    }
  }
}
