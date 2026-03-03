/**
 * Plugin adapter — local replacement for `openclaw/plugin-sdk` and `openclaw/plugin-sdk/account-id`.
 *
 * Every type and value symbol that the Feishu extension imports from the SDK is
 * re-exported here so that the rest of the files can simply swap the import path.
 * Function bodies that depend on the full OpenClaw runtime are implemented as
 * stubs that throw at runtime (marked with `STUB`); the types are complete.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// account-id (openclaw/plugin-sdk/account-id)
// ---------------------------------------------------------------------------

export const DEFAULT_ACCOUNT_ID = "default";

export function normalizeAccountId(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  return trimmed || DEFAULT_ACCOUNT_ID;
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/**
 * Minimal representation of the full OpenClaw config object.
 * Only fields actually referenced by the feishu extension are included.
 */
export type ClawdbotConfig = {
  channels?: Record<string, Record<string, unknown> | undefined>;
  messages?: {
    groupChat?: {
      historyLimit?: number;
    };
  };
  commands?: {
    useAccessGroups?: boolean;
  };
  /** Alias used by dynamic-agent.ts */
  agents?: {
    list?: Array<{ id: string; workspace?: string; agentDir?: string }>;
  };
  bindings?: Array<{
    agentId?: string;
    match?: {
      channel?: string;
      peer?: { kind?: string; id?: string };
    };
  }>;
};

/** Alias — several files import `OpenClawConfig` which is the same shape. */
export type OpenClawConfig = ClawdbotConfig;

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

export type RuntimeEnv = {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

// ---------------------------------------------------------------------------
// PluginRuntime — the runtime object stored via setFeishuRuntime / getFeishuRuntime
// ---------------------------------------------------------------------------

export type SavedMedia = {
  path: string;
  contentType: string;
};

export type PluginRuntime = {
  media: {
    detectMime: (params: { buffer: Buffer }) => Promise<string>;
    loadWebMedia: (
      url: string,
      opts: { maxBytes: number; optimizeImages: boolean },
    ) => Promise<{ buffer: Buffer; fileName?: string }>;
  };
  config: {
    writeConfigFile: (cfg: OpenClawConfig) => Promise<void>;
  };
  channel: {
    media: {
      saveMediaBuffer: (
        buffer: Buffer,
        contentType: string,
        direction: "inbound" | "outbound",
        maxBytes: number,
        fileName?: string,
      ) => Promise<SavedMedia>;
    };
    text: {
      chunkMarkdownText: (text: string, limit: number) => string[];
      chunkTextWithMode: (
        text: string,
        limit: number,
        mode: string,
      ) => string[];
      resolveTextChunkLimit: (
        cfg: ClawdbotConfig,
        channel: string,
        accountId?: string,
        opts?: { fallbackLimit?: number },
      ) => number;
      resolveChunkMode: (cfg: ClawdbotConfig, channel: string) => string;
      resolveMarkdownTableMode: (params: {
        cfg: ClawdbotConfig;
        channel: string;
      }) => string;
      convertMarkdownTables: (text: string, mode: string) => string;
    };
    commands: {
      shouldComputeCommandAuthorized: (
        content: string,
        cfg: ClawdbotConfig,
      ) => boolean;
      resolveCommandAuthorizedFromAuthorizers: (params: {
        useAccessGroups: boolean;
        authorizers: Array<{ configured: boolean; allowed: boolean }>;
      }) => boolean | undefined;
    };
    pairing: {
      readAllowFromStore: (channel: string) => Promise<string[]>;
      upsertPairingRequest: (params: {
        channel: string;
        id: string;
        meta?: Record<string, unknown>;
      }) => Promise<{ code: string; created: boolean }>;
      buildPairingReply: (params: {
        channel: string;
        idLine: string;
        code: string;
      }) => string;
    };
    routing: {
      resolveAgentRoute: (params: {
        cfg: ClawdbotConfig;
        channel: string;
        accountId: string;
        peer: { kind: string; id: string };
        parentPeer?: { kind: string; id: string } | null;
      }) => {
        sessionKey: string;
        accountId: string;
        agentId: string;
        matchedBy: string;
      };
    };
    reply: {
      resolveEnvelopeFormatOptions: (cfg: ClawdbotConfig) => Record<string, unknown>;
      formatAgentEnvelope: (params: {
        channel: string;
        from: string;
        timestamp: Date | number;
        body: string;
        envelope?: Record<string, unknown>;
      }) => string;
      finalizeInboundContext: (
        payload: Record<string, unknown>,
      ) => Record<string, unknown>;
      dispatchReplyFromConfig: (params: {
        ctx: Record<string, unknown>;
        cfg: ClawdbotConfig;
        dispatcher: ReplyDispatcher;
        replyOptions: Record<string, unknown>;
      }) => Promise<{ queuedFinal: boolean; counts: { final: number } }>;
      resolveHumanDelayConfig: (
        cfg: ClawdbotConfig,
        agentId: string,
      ) => Record<string, unknown> | undefined;
      createReplyDispatcherWithTyping: (params: {
        responsePrefix?: string;
        responsePrefixContextProvider?: unknown;
        humanDelay?: Record<string, unknown> | undefined;
        onReplyStart?: () => void;
        deliver: (payload: ReplyPayload, info?: { kind?: string }) => Promise<void>;
        onError?: (error: unknown, info: { kind: string }) => Promise<void>;
        onIdle?: () => Promise<void>;
        onCleanup?: () => void;
      }) => {
        dispatcher: ReplyDispatcher;
        replyOptions: Record<string, unknown>;
        markDispatchIdle: () => void;
      };
    };
  };
  system: {
    enqueueSystemEvent: (
      label: string,
      opts: { sessionKey: string; contextKey: string },
    ) => void;
  };
};

// ---------------------------------------------------------------------------
// Plugin registration API
// ---------------------------------------------------------------------------

export type OpenClawPluginApi = {
  runtime: PluginRuntime;
  /** Full config object — used by tool registration to resolve accounts. */
  config?: ClawdbotConfig;
  registerChannel: (params: { plugin: ChannelPlugin<never> }) => void;
  registerTool: (tool: AgentToolDefinition) => void;
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  [key: string]: unknown;
};

export function emptyPluginConfigSchema(): Record<string, unknown> {
  return { type: "object", properties: {} };
}

// ---------------------------------------------------------------------------
// Channel plugin types
// ---------------------------------------------------------------------------

export type ChannelMeta = {
  id: string;
  label: string;
  selectionLabel?: string;
  docsPath?: string;
  docsLabel?: string;
  blurb?: string;
  aliases?: string[];
  order?: number;
};

export type ChannelPlugin<TAccount = unknown> = {
  id: string;
  meta: ChannelMeta;
  pairing?: {
    idLabel?: string;
    normalizeAllowEntry?: (entry: string) => string;
    notifyApproval?: (params: {
      cfg: ClawdbotConfig;
      id: string;
    }) => Promise<void>;
  };
  capabilities?: {
    chatTypes?: string[];
    polls?: boolean;
    threads?: boolean;
    media?: boolean;
    reactions?: boolean;
    edit?: boolean;
    reply?: boolean;
  };
  agentPrompt?: {
    messageToolHints?: () => string[];
  };
  groups?: {
    resolveToolPolicy?: (
      params: ChannelGroupContext,
    ) => GroupToolPolicyConfig | undefined;
  };
  reload?: { configPrefixes?: string[] };
  configSchema?: {
    schema: Record<string, unknown>;
  };
  config?: {
    listAccountIds: (cfg: ClawdbotConfig) => string[];
    resolveAccount: (cfg: ClawdbotConfig, accountId: string) => TAccount;
    defaultAccountId: (cfg: ClawdbotConfig) => string;
    setAccountEnabled: (params: {
      cfg: ClawdbotConfig;
      accountId: string;
      enabled: boolean;
    }) => ClawdbotConfig;
    deleteAccount: (params: {
      cfg: ClawdbotConfig;
      accountId: string;
    }) => ClawdbotConfig;
    isConfigured: (account: TAccount) => boolean;
    describeAccount: (
      account: TAccount,
    ) => Record<string, unknown>;
    resolveAllowFrom: (params: {
      cfg: ClawdbotConfig;
      accountId: string;
    }) => string[];
    formatAllowFrom: (params: { allowFrom: string[] }) => string[];
  };
  security?: {
    collectWarnings: (params: {
      cfg: ClawdbotConfig;
      accountId: string;
    }) => string[];
  };
  setup?: {
    resolveAccountId: () => string;
    applyAccountConfig: (params: {
      cfg: ClawdbotConfig;
      accountId: string;
    }) => ClawdbotConfig;
  };
  onboarding?: ChannelOnboardingAdapter;
  messaging?: {
    normalizeTarget?: (raw: string) => string | undefined;
    targetResolver?: {
      looksLikeId: (raw: string) => boolean;
      hint: string;
    };
  };
  directory?: {
    self: () => Promise<unknown>;
    listPeers: (params: {
      cfg: ClawdbotConfig;
      query?: string | null;
      limit?: number | null;
      accountId?: string | null;
    }) => Promise<unknown[]>;
    listGroups: (params: {
      cfg: ClawdbotConfig;
      query?: string | null;
      limit?: number | null;
      accountId?: string | null;
    }) => Promise<unknown[]>;
    listPeersLive: (params: {
      cfg: ClawdbotConfig;
      query?: string | null;
      limit?: number | null;
      accountId?: string | null;
    }) => Promise<unknown[]>;
    listGroupsLive: (params: {
      cfg: ClawdbotConfig;
      query?: string | null;
      limit?: number | null;
      accountId?: string | null;
    }) => Promise<unknown[]>;
  };
  outbound?: ChannelOutboundAdapter;
  status?: {
    defaultRuntime: Record<string, unknown>;
    buildChannelSummary: (params: {
      snapshot: Record<string, unknown>;
    }) => Record<string, unknown>;
    probeAccount: (params: { account: unknown }) => Promise<unknown>;
    buildAccountSnapshot: (params: {
      account: unknown;
      runtime?: Record<string, unknown>;
      probe?: unknown;
    }) => Record<string, unknown>;
  };
  gateway?: {
    startAccount: (ctx: {
      cfg: ClawdbotConfig;
      accountId: string;
      runtime: RuntimeEnv;
      abortSignal: AbortSignal;
      setStatus: (s: Record<string, unknown>) => void;
      log?: { info: (...args: unknown[]) => void };
    }) => Promise<void>;
  };
};

// ---------------------------------------------------------------------------
// Outbound adapter
// ---------------------------------------------------------------------------

export type ChannelOutboundAdapter = {
  deliveryMode: string;
  chunker: (text: string, limit: number) => string[];
  chunkerMode: string;
  textChunkLimit: number;
  sendText: (params: {
    cfg: ClawdbotConfig;
    to: string;
    text: string;
    accountId?: string | null;
  }) => Promise<{ channel: string; messageId: string; chatId: string }>;
  sendMedia: (params: {
    cfg: ClawdbotConfig;
    to: string;
    text?: string | null;
    mediaUrl?: string | null;
    accountId?: string | null;
  }) => Promise<{ channel: string; messageId: string; chatId: string }>;
};

// ---------------------------------------------------------------------------
// Onboarding adapter
// ---------------------------------------------------------------------------

export type DmPolicy = "open" | "pairing" | "allowlist";

export type WizardPrompter = {
  note: (message: string, title?: string) => Promise<void>;
  text: (params: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (value: string | undefined) => string | undefined;
  }) => Promise<string>;
  confirm: (params: {
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean>;
  select: <T = string>(params: {
    message: string;
    options: Array<{ value: T; label: string }>;
    initialValue?: T;
  }) => Promise<T>;
};

export type ChannelOnboardingDmPolicy = {
  label: string;
  channel: string;
  policyKey: string;
  allowFromKey: string;
  getCurrent: (cfg: ClawdbotConfig) => DmPolicy;
  setPolicy: (cfg: ClawdbotConfig, policy: DmPolicy) => ClawdbotConfig;
  promptAllowFrom: (params: {
    cfg: ClawdbotConfig;
    prompter: WizardPrompter;
  }) => Promise<ClawdbotConfig>;
};

export type ChannelOnboardingAdapter = {
  channel: string;
  getStatus: (params: { cfg: ClawdbotConfig }) => Promise<{
    channel: string;
    configured: boolean;
    statusLines: string[];
    selectionHint: string;
    quickstartScore: number;
  }>;
  configure: (params: {
    cfg: ClawdbotConfig;
    prompter: WizardPrompter;
  }) => Promise<{ cfg: ClawdbotConfig; accountId: string }>;
  dmPolicy: ChannelOnboardingDmPolicy;
  disable: (cfg: ClawdbotConfig) => ClawdbotConfig;
};

// ---------------------------------------------------------------------------
// Probe result
// ---------------------------------------------------------------------------

export type BaseProbeResult<E = string> = {
  ok: boolean;
  error?: E;
};

// ---------------------------------------------------------------------------
// Policy types
// ---------------------------------------------------------------------------

export type AllowlistMatch<Source extends string = string> = {
  allowed: boolean;
  matchKey?: string;
  matchSource?: Source;
};

export type ChannelGroupContext = {
  cfg: ClawdbotConfig;
  groupId?: string;
  accountId?: string;
};

export type GroupToolPolicyConfig = {
  allow?: string[];
  deny?: string[];
};

// ---------------------------------------------------------------------------
// Reply types
// ---------------------------------------------------------------------------

export type ReplyPayload = {
  text?: string;
};

export type ReplyDispatcher = {
  dispatch: (payload: ReplyPayload) => Promise<void>;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// History types
// ---------------------------------------------------------------------------

export type HistoryEntry = {
  sender: string;
  body: string;
  timestamp: number;
  messageId?: string;
};

export const DEFAULT_GROUP_HISTORY_LIMIT = 20;

export function recordPendingHistoryEntryIfEnabled(params: {
  historyMap: Map<string, HistoryEntry[]>;
  historyKey: string;
  limit: number;
  entry: HistoryEntry;
}): void {
  if (params.limit <= 0) return;
  const list = params.historyMap.get(params.historyKey) ?? [];
  list.push(params.entry);
  while (list.length > params.limit) {
    list.shift();
  }
  params.historyMap.set(params.historyKey, list);
}

export function clearHistoryEntriesIfEnabled(params: {
  historyMap: Map<string, HistoryEntry[]>;
  historyKey: string;
  limit: number;
}): void {
  if (params.limit <= 0) return;
  params.historyMap.delete(params.historyKey);
}

export function buildPendingHistoryContextFromMap(params: {
  historyMap: Map<string, HistoryEntry[]>;
  historyKey: string;
  limit: number;
  currentMessage: string;
  formatEntry: (entry: HistoryEntry) => string;
}): string {
  const entries = params.historyMap.get(params.historyKey) ?? [];
  if (entries.length === 0) return params.currentMessage;
  const formatted = entries.map(params.formatEntry);
  return [...formatted, params.currentMessage].join("\n\n");
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

export function buildAgentMediaPayload(
  mediaList: Array<{ path: string; contentType?: string; placeholder: string }>,
): Record<string, unknown> {
  if (mediaList.length === 0) return {};
  return {
    MediaPaths: mediaList.map((m) => m.path),
    MediaContentTypes: mediaList
      .map((m) => m.contentType)
      .filter((ct): ct is string => Boolean(ct)),
    MediaPlaceholders: mediaList.map((m) => m.placeholder),
  };
}

// ---------------------------------------------------------------------------
// Group policy helpers
// ---------------------------------------------------------------------------

export function resolveDefaultGroupPolicy(
  _cfg: ClawdbotConfig,
): "open" | "allowlist" | "disabled" {
  // Stub: default to allowlist
  return "allowlist";
}

export function resolveAllowlistProviderRuntimeGroupPolicy(params: {
  providerConfigPresent: boolean;
  groupPolicy?: string;
  defaultGroupPolicy: string;
}): { groupPolicy: "open" | "allowlist" | "disabled" } {
  const policy = params.groupPolicy ?? params.defaultGroupPolicy;
  if (policy === "open" || policy === "allowlist" || policy === "disabled") {
    return { groupPolicy: policy };
  }
  return { groupPolicy: "allowlist" };
}

export function resolveOpenProviderRuntimeGroupPolicy(params: {
  providerConfigPresent: boolean;
  groupPolicy?: string;
  defaultGroupPolicy: string;
}): {
  groupPolicy: "open" | "allowlist" | "disabled";
  providerMissingFallbackApplied: boolean;
} {
  const resolved = resolveAllowlistProviderRuntimeGroupPolicy(params);
  return { ...resolved, providerMissingFallbackApplied: false };
}

export function warnMissingProviderGroupPolicyFallbackOnce(_params: {
  providerMissingFallbackApplied: boolean;
  providerKey: string;
  accountId: string;
  log: (...args: unknown[]) => void;
}): void {
  // Intentional no-op in adapter
}

// ---------------------------------------------------------------------------
// Channel status helpers
// ---------------------------------------------------------------------------

export function createDefaultChannelRuntimeState(
  accountId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    accountId,
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    ...extra,
  };
}

export function buildBaseChannelStatusSummary(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  return {
    accountId: snapshot.accountId,
    running: snapshot.running ?? false,
    lastStartAt: snapshot.lastStartAt ?? null,
    lastStopAt: snapshot.lastStopAt ?? null,
    lastError: snapshot.lastError ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pairing helpers
// ---------------------------------------------------------------------------

export const PAIRING_APPROVED_MESSAGE =
  "Your pairing request has been approved. You can now chat with me.";

// ---------------------------------------------------------------------------
// Reply dispatcher helpers
// ---------------------------------------------------------------------------

export function createReplyPrefixContext(_params: {
  cfg: ClawdbotConfig;
  agentId: string;
}): {
  responsePrefix: string | undefined;
  responsePrefixContextProvider: unknown;
  onModelSelected: unknown;
} {
  return {
    responsePrefix: undefined,
    responsePrefixContextProvider: undefined,
    onModelSelected: undefined,
  };
}

export function createTypingCallbacks(params: {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  onStartError: (err: unknown) => void;
  onStopError: (err: unknown) => void;
}): {
  onReplyStart?: () => void;
  onIdle?: () => void;
  onCleanup?: () => void;
} {
  return {
    onReplyStart: () => {
      params.start().catch(params.onStartError);
    },
    onIdle: () => {
      params.stop().catch(params.onStopError);
    },
    onCleanup: () => {
      params.stop().catch(params.onStopError);
    },
  };
}

export function logTypingFailure(params: {
  log: (message: string) => void;
  channel: string;
  action: string;
  error: unknown;
}): void {
  params.log(`${params.channel}: typing ${params.action} failed: ${String(params.error)}`);
}

// ---------------------------------------------------------------------------
// Onboarding helpers
// ---------------------------------------------------------------------------

export function formatDocsLink(docsPath: string, _label: string): string {
  return `https://docs.openclaw.ai${docsPath}`;
}

export function addWildcardAllowFrom(
  existing?: Array<string | number>,
): Array<string | number> {
  const list = [...(existing ?? [])];
  if (!list.some((e) => String(e).trim() === "*")) {
    list.push("*");
  }
  return list;
}

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

export type DedupeCache = {
  check: (key: string) => boolean;
};

export function createDedupeCache(params: {
  ttlMs: number;
  maxSize: number;
}): DedupeCache {
  const map = new Map<string, number>();

  return {
    check(key: string): boolean {
      const now = Date.now();
      // Evict expired
      if (map.size > params.maxSize) {
        for (const [k, ts] of map) {
          if (now - ts > params.ttlMs) {
            map.delete(k);
          }
        }
      }
      if (map.has(key)) {
        const ts = map.get(key)!;
        if (now - ts < params.ttlMs) {
          return true; // duplicate
        }
      }
      map.set(key, now);
      return false; // first time
    },
  };
}

export type PersistentDedupe = {
  checkAndRecord: (
    key: string,
    opts: {
      namespace?: string;
      onDiskError?: (error: unknown) => void;
    },
  ) => Promise<boolean>;
};

export function createPersistentDedupe(params: {
  ttlMs: number;
  memoryMaxSize: number;
  fileMaxEntries: number;
  resolveFilePath: (namespace: string) => string;
}): PersistentDedupe {
  const memoryMap = new Map<string, number>();

  return {
    async checkAndRecord(key, opts): Promise<boolean> {
      const now = Date.now();
      // Memory check first
      if (memoryMap.has(key)) {
        const ts = memoryMap.get(key)!;
        if (now - ts < params.ttlMs) {
          return false; // duplicate
        }
      }
      memoryMap.set(key, now);

      // Evict old memory entries
      if (memoryMap.size > params.memoryMaxSize) {
        for (const [k, ts] of memoryMap) {
          if (now - ts > params.ttlMs) {
            memoryMap.delete(k);
          }
        }
      }

      // Persistent check
      const namespace = opts.namespace ?? "global";
      const filePath = params.resolveFilePath(namespace);
      try {
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });

        let entries: Record<string, number> = {};
        try {
          const raw = await fs.promises.readFile(filePath, "utf-8");
          entries = JSON.parse(raw) as Record<string, number>;
        } catch {
          // File doesn't exist yet
        }

        if (entries[key] && now - entries[key] < params.ttlMs) {
          return false; // duplicate
        }

        entries[key] = now;

        // Evict old entries
        const keys = Object.keys(entries);
        if (keys.length > params.fileMaxEntries) {
          const sorted = keys.sort((a, b) => (entries[a] ?? 0) - (entries[b] ?? 0));
          for (let i = 0; i < sorted.length - params.fileMaxEntries; i++) {
            delete entries[sorted[i]!];
          }
        }

        await fs.promises.writeFile(filePath, JSON.stringify(entries), "utf-8");
      } catch (error) {
        opts.onDiskError?.(error);
      }

      return true; // first time (or disk error fallback)
    },
  };
}

// ---------------------------------------------------------------------------
// Temp download path helper
// ---------------------------------------------------------------------------

export async function withTempDownloadPath<T>(
  opts: { prefix: string },
  fn: (tmpPath: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), opts.prefix));
  const tmpPath = path.join(tmpDir, "download");
  try {
    return await fn(tmpPath);
  } finally {
    try {
      await fs.promises.rm(tmpDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Request body limit guard (used by webhook mode)
// ---------------------------------------------------------------------------

export function installRequestBodyLimitGuard(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    maxBytes: number;
    timeoutMs: number;
    responseFormat: string;
  },
): { isTripped: () => boolean; dispose: () => void } {
  let tripped = false;
  let received = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onData = (chunk: Buffer) => {
    received += chunk.length;
    if (received > opts.maxBytes) {
      tripped = true;
      req.destroy();
      if (!res.headersSent) {
        res.statusCode = 413;
        res.end("Payload Too Large");
      }
    }
  };

  const onTimeout = () => {
    if (!tripped && !res.headersSent) {
      tripped = true;
      req.destroy();
      res.statusCode = 408;
      res.end("Request Timeout");
    }
  };

  req.on("data", onData);
  timer = setTimeout(onTimeout, opts.timeoutMs);

  return {
    isTripped: () => tripped,
    dispose: () => {
      req.removeListener("data", onData);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
