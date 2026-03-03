/**
 * Web Search Skill — Built-in
 * Provides web search capabilities using DuckDuckGo (free, no API key) or
 * optionally Tavily/Brave when API keys are configured.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  source: string;
}

export type WebSearchProvider = 'duckduckgo' | 'tavily' | 'brave';

export interface WebSearchOptions {
  provider?: WebSearchProvider;
  maxResults?: number;
  /** API key for Tavily or Brave (not needed for DuckDuckGo) */
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// DuckDuckGo (default, free, no API key)
// ---------------------------------------------------------------------------

/**
 * Search using DuckDuckGo's HTML endpoint.
 * Parses the HTML response to extract search results.
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ClawDesktop/1.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status}`);
  }

  const html = await response.text();
  return parseDuckDuckGoResults(html, maxResults);
}

function parseDuckDuckGoResults(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  // Match result blocks: <a class="result__a" href="...">title</a>
  // and <a class="result__snippet" ...>snippet</a>
  const resultPattern =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;

  const titles: Array<{ url: string; title: string }> = [];
  let match;

  while ((match = resultPattern.exec(html)) !== null) {
    const rawUrl = match[1];
    const rawTitle = match[2].replace(/<[^>]*>/g, '').trim();

    // DuckDuckGo wraps URLs in a redirect; extract the actual URL
    let finalUrl = rawUrl;
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      finalUrl = decodeURIComponent(uddgMatch[1]);
    }

    if (finalUrl && rawTitle) {
      titles.push({ url: finalUrl, title: rawTitle });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]*>/g, '').trim());
  }

  for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i] ?? '',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tavily (optional, requires API key)
// ---------------------------------------------------------------------------

async function searchTavily(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: 'basic',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily search failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };

  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

// ---------------------------------------------------------------------------
// Brave (optional, requires API key)
// ---------------------------------------------------------------------------

async function searchBrave(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave search failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    web?: { results: Array<{ title: string; url: string; description: string }> };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Perform a web search using the configured provider.
 * Falls back to DuckDuckGo if no API key is provided.
 */
export async function webSearch(
  query: string,
  opts?: WebSearchOptions,
): Promise<WebSearchResponse> {
  const maxResults = opts?.maxResults ?? 5;
  const provider = opts?.provider ?? (opts?.apiKey ? 'tavily' : 'duckduckgo');

  let results: WebSearchResult[];
  let source: string;

  switch (provider) {
    case 'tavily':
      if (!opts?.apiKey) throw new Error('Tavily API key required');
      results = await searchTavily(query, opts.apiKey, maxResults);
      source = 'tavily';
      break;

    case 'brave':
      if (!opts?.apiKey) throw new Error('Brave API key required');
      results = await searchBrave(query, opts.apiKey, maxResults);
      source = 'brave';
      break;

    case 'duckduckgo':
    default:
      results = await searchDuckDuckGo(query, maxResults);
      source = 'duckduckgo';
      break;
  }

  return { query, results, source };
}

// ---------------------------------------------------------------------------
// Skill tool definition (for agent registration)
// ---------------------------------------------------------------------------

export const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description:
    'Search the web for current information. Returns titles, URLs, and snippets from search results.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results (1-10, default 5)',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
  } as Record<string, unknown>,
  handler: async (params: Record<string, unknown>) => {
    const query = params.query as string;
    const maxResults = (params.max_results as number) ?? 5;
    try {
      return await webSearch(query, { maxResults });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};
