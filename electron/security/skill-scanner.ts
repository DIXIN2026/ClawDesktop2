/**
 * Skill Security Scanner
 * Scans skill source code for potentially dangerous patterns.
 * Ported from openclaw/src/security/skill-scanner.ts, adapted for ClawDesktop2.
 */

import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillScanSeverity = "info" | "warn" | "critical";

export type SkillScanFinding = {
  ruleId: string;
  severity: SkillScanSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type SkillScanSummary = {
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  findings: SkillScanFinding[];
};

export type SkillScanOptions = {
  maxFiles?: number;
  maxFileBytes?: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCANNABLE_EXTENSIONS = new Set([
  ".js", ".ts", ".mjs", ".cjs", ".mts", ".cts", ".jsx", ".tsx",
]);

const DEFAULT_MAX_SCAN_FILES = 500;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024; // 1 MB

export function isScannable(filePath: string): boolean {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

type LineRule = {
  ruleId: string;
  severity: SkillScanSeverity;
  message: string;
  pattern: RegExp;
  requiresContext?: RegExp;
};

type SourceRule = {
  ruleId: string;
  severity: SkillScanSeverity;
  message: string;
  pattern: RegExp;
  requiresContext?: RegExp;
};

const LINE_RULES: LineRule[] = [
  {
    ruleId: "dangerous-exec",
    severity: "critical",
    message: "Shell command execution detected (child_process)",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    requiresContext: /child_process/,
  },
  {
    ruleId: "dynamic-code-execution",
    severity: "critical",
    message: "Dynamic code execution detected",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    ruleId: "crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
  },
  {
    ruleId: "suspicious-network",
    severity: "warn",
    message: "WebSocket connection to non-standard port",
    pattern: /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/,
  },
];

const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000]);

const SOURCE_RULES: SourceRule[] = [
  {
    ruleId: "potential-exfiltration",
    severity: "warn",
    message: "File read combined with network send — possible data exfiltration",
    pattern: /readFileSync|readFile/,
    requiresContext: /\bfetch\b|\bpost\b|http\.request/i,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Hex-encoded string sequence detected (possible obfuscation)",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}/,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Large base64 payload with decode call detected (possible obfuscation)",
    pattern: /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/,
  },
  {
    ruleId: "env-harvesting",
    severity: "critical",
    message:
      "Environment variable access combined with network send — possible credential harvesting",
    pattern: /process\.env/,
    requiresContext: /\bfetch\b|\bpost\b|http\.request/i,
  },
];

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

function truncateEvidence(evidence: string, maxLen = 120): string {
  if (evidence.length <= maxLen) return evidence;
  return `${evidence.slice(0, maxLen)}…`;
}

export function scanSource(source: string, filePath: string): SkillScanFinding[] {
  const findings: SkillScanFinding[] = [];
  const lines = source.split("\n");
  const matchedLineRules = new Set<string>();

  for (const rule of LINE_RULES) {
    if (matchedLineRules.has(rule.ruleId)) continue;
    if (rule.requiresContext && !rule.requiresContext.test(source)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = rule.pattern.exec(line);
      if (!match) continue;

      if (rule.ruleId === "suspicious-network") {
        const port = parseInt(match[1], 10);
        if (STANDARD_PORTS.has(port)) continue;
      }

      findings.push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: filePath,
        line: i + 1,
        message: rule.message,
        evidence: truncateEvidence(line.trim()),
      });
      matchedLineRules.add(rule.ruleId);
      break;
    }
  }

  const matchedSourceRules = new Set<string>();
  for (const rule of SOURCE_RULES) {
    const ruleKey = `${rule.ruleId}::${rule.message}`;
    if (matchedSourceRules.has(ruleKey)) continue;
    if (!rule.pattern.test(source)) continue;
    if (rule.requiresContext && !rule.requiresContext.test(source)) continue;

    let matchLine = 0;
    let matchEvidence = "";
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        matchLine = i + 1;
        matchEvidence = lines[i].trim();
        break;
      }
    }

    if (matchLine === 0) {
      matchLine = 1;
      matchEvidence = source.slice(0, 120);
    }

    findings.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      file: filePath,
      line: matchLine,
      message: rule.message,
      evidence: truncateEvidence(matchEvidence),
    });
    matchedSourceRules.add(ruleKey);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

async function walkDirWithLimit(dirPath: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0 && files.length < maxFiles) {
    const currentDir = stack.pop();
    if (!currentDir) break;

    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (isScannable(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function readScannableSource(filePath: string, maxFileBytes: number): Promise<string | null> {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size > maxFileBytes) return null;
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function scanDirectory(
  dirPath: string,
  opts?: SkillScanOptions,
): Promise<SkillScanFinding[]> {
  const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_SCAN_FILES;
  const maxFileBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const files = await walkDirWithLimit(dirPath, maxFiles);
  const allFindings: SkillScanFinding[] = [];

  for (const file of files) {
    const source = await readScannableSource(file, maxFileBytes);
    if (source == null) continue;
    allFindings.push(...scanSource(source, file));
  }

  return allFindings;
}

export async function scanDirectoryWithSummary(
  dirPath: string,
  opts?: SkillScanOptions,
): Promise<SkillScanSummary> {
  const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_SCAN_FILES;
  const maxFileBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const files = await walkDirWithLimit(dirPath, maxFiles);
  const allFindings: SkillScanFinding[] = [];
  let scannedFiles = 0;

  for (const file of files) {
    const source = await readScannableSource(file, maxFileBytes);
    if (source == null) continue;
    scannedFiles += 1;
    allFindings.push(...scanSource(source, file));
  }

  return {
    scannedFiles,
    critical: allFindings.filter((f) => f.severity === "critical").length,
    warn: allFindings.filter((f) => f.severity === "warn").length,
    info: allFindings.filter((f) => f.severity === "info").length,
    findings: allFindings,
  };
}
