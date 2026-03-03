/**
 * QQ Bot Channel — Exponential backoff reconnect delays
 */

const BASE_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];

/** Build array of delay values for reconnect attempts */
export function buildReconnectDelays(): number[] {
  return BASE_DELAYS;
}

/** Get delay for a given attempt number */
export function getReconnectDelay(attempt: number): number {
  return BASE_DELAYS[Math.min(attempt, BASE_DELAYS.length - 1)] ?? 60000;
}
