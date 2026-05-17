import type { Safe402CheckStatus, Safe402ReportCheck } from "../../reports/index.js";

export type Safe402AuditSeverity = "PASS" | "INFO" | "WARN" | "FAIL" | "CRITICAL";

export type Safe402AuditCheckCategory =
  | "probe"
  | "challenge"
  | "stability"
  | "payment_intent"
  | "retry"
  | "duplicate"
  | "privacy"
  | "idempotency"
  | "facilitator"
  | "mcp"
  | "delivery"
  | "policy";

export type Safe402AuditCheck = Safe402ReportCheck & {
  severity: Safe402AuditSeverity;
  code: string;
  category: Safe402AuditCheckCategory;
  endpoint?: string;
  recommendedFix?: string;
  details?: Record<string, unknown>;
};

export function auditCheck(input: {
  name: string;
  severity: Safe402AuditSeverity;
  code: string;
  category: Safe402AuditCheckCategory;
  reason: string;
  endpoint?: string;
  fix?: string;
  recommendedFix?: string;
  details?: Record<string, unknown>;
}): Safe402AuditCheck {
  const recommendedFix = input.recommendedFix ?? input.fix;

  return {
    name: input.name,
    severity: input.severity,
    status: severityToStatus(input.severity),
    code: input.code,
    category: input.category,
    reason: input.reason,
    endpoint: input.endpoint,
    fix: recommendedFix,
    recommendedFix,
    details: input.details
  };
}

export function severityToStatus(severity: Safe402AuditSeverity): Safe402CheckStatus {
  if (severity === "CRITICAL" || severity === "FAIL") {
    return "fail";
  }

  if (severity === "WARN") {
    return "warn";
  }

  return "pass";
}

export function statusToSeverity(status: Safe402CheckStatus): Safe402AuditSeverity {
  if (status === "fail") {
    return "FAIL";
  }

  if (status === "warn") {
    return "WARN";
  }

  return "PASS";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function scalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return undefined;
}

export function normalizeScalar(value: unknown): string {
  return scalarString(value)?.toLowerCase() ?? "";
}

export function includesNormalized(values: string[] | undefined, value: string | undefined): boolean {
  return Boolean(value && values?.some(item => item.toLowerCase() === value.toLowerCase()));
}
