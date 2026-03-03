/**
 * ClawHub API Client
 * Fetches skill listings from the ClawHub marketplace.
 * Gracefully falls back when the API is unavailable.
 */
import type { SkillManifest } from './loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClawHubSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  downloads: number;
  rating: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAWHUB_API = 'https://api.clawhub.dev/v1';
const REQUEST_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data: unknown = await response.json();
    return data as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search ClawHub for skills matching a query and optional category.
 */
export async function searchClawHub(
  query: string,
  category?: string,
): Promise<ClawHubSkill[]> {
  const params = new URLSearchParams({ q: query });
  if (category) {
    params.set('category', category);
  }

  const result = await fetchJson<{ skills: ClawHubSkill[] }>(
    `${CLAWHUB_API}/skills/search?${params.toString()}`,
  );

  if (result && Array.isArray(result.skills)) {
    return result.skills;
  }

  return [];
}

/**
 * Get a single skill's details from ClawHub by ID.
 */
export async function getClawHubSkill(id: string): Promise<ClawHubSkill | null> {
  return fetchJson<ClawHubSkill>(`${CLAWHUB_API}/skills/${encodeURIComponent(id)}`);
}

/**
 * Download a skill's full manifest from ClawHub.
 */
export async function downloadSkillManifest(id: string): Promise<SkillManifest | null> {
  return fetchJson<SkillManifest>(
    `${CLAWHUB_API}/skills/${encodeURIComponent(id)}/manifest`,
  );
}
