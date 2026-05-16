import type { Safe402PrivacyFinding } from "../types.js";

export const SENSITIVE_QUERY_KEYS = [
  "api_key",
  "apikey",
  "access_token",
  "auth_token",
  "token",
  "secret",
  "password",
  "private_key",
  "wallet",
  "wallet_address"
];

const FINDING_PATTERNS: Array<{
  type: Safe402PrivacyFinding["type"];
  pattern: RegExp;
}> = [
  { type: "email", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: "phone", pattern: /\+?\d[\d\s().-]{8,}\d/g },
  { type: "api_key", pattern: /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/gi },
  { type: "bearer_token", pattern: /bearer\s+[A-Za-z0-9._-]{12,}/gi },
  { type: "private_task_reason", pattern: /\b(confidential|private|internal|customer|patient|client|case\s?id|ticket\s?id|task\s?reason)\b/gi },
  { type: "wallet_linked_note", pattern: /\b(wallet|address|payee|recipient)\b[^.]{0,80}\b(owns|belongs|linked|identity|user)\b/gi },
  { type: "personal_identifier", pattern: /\b(ssn|passport|driver'?s?\s+license|national\s+id|tax\s+id)\b/gi }
];

export function findSensitiveStrings(value: unknown, field = "metadata"): Safe402PrivacyFinding[] {
  const findings: Safe402PrivacyFinding[] = [];
  visit(value, field, findings, 0);
  return dedupeFindings(findings);
}

export function redactSensitiveText(value: string): string {
  let redacted = value;

  for (const { pattern, type } of FINDING_PATTERNS) {
    redacted = redacted.replace(pattern, `[redacted:${type}]`);
  }

  return redactUrlSensitiveParams(redacted);
}

export function redactUrlSensitiveParams(value: string): string {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.some(sensitive => sensitive.toLowerCase() === key.toLowerCase())) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.href;
  } catch {
    return value.replace(/([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|private[_-]?key)=)[^&#\s]+/gi, "$1[redacted]");
  }
}

function visit(value: unknown, field: string, findings: Safe402PrivacyFinding[], depth: number) {
  if (depth > 6 || value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    scanString(value, field, findings);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${field}[${index}]`, findings, depth + 1));
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      visit(nested, field ? `${field}.${key}` : key, findings, depth + 1);
    }
  }
}

function scanString(value: string, field: string, findings: Safe402PrivacyFinding[]) {
  for (const key of findSensitiveQueryKeys(value)) {
    findings.push({ field, type: "sensitive_query", value: key });
  }

  for (const { type, pattern } of FINDING_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(value)) !== null) {
      if (type === "phone" && isInsideHexAddress(value, match.index, match[0].length)) {
        continue;
      }

      findings.push({
        field,
        type,
        value: `[redacted:${type}]`
      });
    }
  }
}

function isInsideHexAddress(value: string, index: number, length: number): boolean {
  const window = value.slice(Math.max(0, index - 2), Math.min(value.length, index + length + 42));
  return /0x[0-9a-fA-F]{20,}/.test(window);
}

function findSensitiveQueryKeys(value: string): string[] {
  const matches = value.match(/[?&]([^=&#\s]+)=/g) ?? [];
  return matches
    .map(match => match.slice(1, -1))
    .filter(key => SENSITIVE_QUERY_KEYS.some(sensitive => sensitive.toLowerCase() === key.toLowerCase()));
}

function dedupeFindings(findings: Safe402PrivacyFinding[]): Safe402PrivacyFinding[] {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = `${finding.field}:${finding.type}:${finding.value ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
