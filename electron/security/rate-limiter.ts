/**
 * Sliding window rate limiter for IPC channels.
 * Each channel has configurable max requests per time window.
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface IpcResponse<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  code?: string;
}

const channelLimits: Record<string, RateLimitConfig> = {
  'chat:send': { maxRequests: 10, windowMs: 10_000 },
  'providers:discover': { maxRequests: 2, windowMs: 30_000 },
  'providers:health': { maxRequests: 5, windowMs: 10_000 },
  'skills:search': { maxRequests: 10, windowMs: 10_000 },
  'channels:start': { maxRequests: 5, windowMs: 10_000 },
  'channels:stop': { maxRequests: 5, windowMs: 10_000 },
  'channels:config': { maxRequests: 5, windowMs: 10_000 },
};

// Store timestamps of recent requests per channel
const requestLog = new Map<string, number[]>();

function isRateLimited(channel: string): boolean {
  const config = channelLimits[channel];
  if (!config) return false;

  const now = Date.now();
  const windowStart = now - config.windowMs;

  let timestamps = requestLog.get(channel);
  if (!timestamps) {
    timestamps = [];
    requestLog.set(channel, timestamps);
  }

  // Remove expired entries
  const firstValid = timestamps.findIndex((t) => t > windowStart);
  if (firstValid > 0) {
    timestamps.splice(0, firstValid);
  } else if (firstValid === -1) {
    timestamps.length = 0;
  }

  if (timestamps.length >= config.maxRequests) {
    return true;
  }

  timestamps.push(now);
  return false;
}

/**
 * Wrap an IPC handler with rate limiting.
 * Returns RATE_LIMITED response if limit exceeded.
 */
export function withRateLimit<T>(
  channel: string,
  handler: (...args: unknown[]) => Promise<IpcResponse<T>>,
): (...args: unknown[]) => Promise<IpcResponse<T>> {
  return async (...args: unknown[]) => {
    if (isRateLimited(channel)) {
      return {
        success: false,
        error: `Rate limit exceeded for ${channel}. Try again shortly.`,
        code: 'RATE_LIMITED',
      };
    }
    return handler(...args);
  };
}

/** Exposed for testing — clear all rate limit state */
export function resetRateLimits(): void {
  requestLog.clear();
}
