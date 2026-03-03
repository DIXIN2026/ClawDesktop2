/**
 * QQ Bot Channel — Token acquisition and refresh
 */
import type { QQAccessToken, QQBotConfig } from './types.js';

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const TOKEN_REFRESH_BUFFER_MS = 120_000; // Refresh 2 min before expiry

let cachedToken: QQAccessToken | null = null;

export async function getAccessToken(config: QQBotConfig): Promise<string> {
  if (cachedToken && !isTokenExpired(cachedToken)) {
    return cachedToken.access_token;
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: config.appId,
      clientSecret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get QQ access token: ${response.status} ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_in: data.expires_in,
    obtained_at: Date.now(),
  };

  return cachedToken.access_token;
}

export function clearTokenCache(): void {
  cachedToken = null;
}

function isTokenExpired(token: QQAccessToken): boolean {
  const elapsed = Date.now() - token.obtained_at;
  return elapsed >= (token.expires_in * 1000 - TOKEN_REFRESH_BUFFER_MS);
}
