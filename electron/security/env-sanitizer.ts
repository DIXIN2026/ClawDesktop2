/**
 * Environment variable sanitizer for CLI agent execution.
 * Strips sensitive keys (API keys, secrets, tokens) before spawning
 * CLI subprocesses to prevent credential leakage via tool use.
 */

/** Patterns that identify sensitive environment variable names */
const SENSITIVE_KEY_PATTERNS = [
  /_API_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /^API_KEY$/i,
  /^SECRET_KEY$/i,
  /^AUTH_TOKEN$/i,
  /^PRIVATE_KEY$/i,
  /^AWS_SECRET_ACCESS_KEY$/i,
  /^GITHUB_TOKEN$/i,
  /^OPENAI_API_KEY$/i,
  /^ANTHROPIC_API_KEY$/i,
  /^MINIMAX_API_KEY$/i,
  /^DEEPSEEK_API_KEY$/i,
  /^GOOGLE_API_KEY$/i,
];

/**
 * Create a sanitized copy of the current environment.
 * Removes all keys matching sensitive patterns.
 * The returned object is safe to pass to `child_process.spawn({ env })`.
 */
export function createSanitizedEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (!isSensitive) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * List which keys would be stripped from the given environment.
 * Useful for logging/debugging.
 */
export function listSensitiveKeys(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return Object.keys(env).filter((key) =>
    SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key)),
  );
}
