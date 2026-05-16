export type Safe402CheckStatus = "pass" | "fail" | "warn";

export type Safe402ReportCheck = {
  name: string;
  status: Safe402CheckStatus;
  reason: string;
  fix?: string;
  details?: Record<string, unknown>;
};

export type Safe402ReportSummary = {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
};

export function summarizeChecks(checks: Pick<Safe402ReportCheck, "status">[]): Safe402ReportSummary {
  return {
    total: checks.length,
    passed: checks.filter(check => check.status === "pass").length,
    failed: checks.filter(check => check.status === "fail").length,
    warnings: checks.filter(check => check.status === "warn").length
  };
}

export function worstStatus(checks: Pick<Safe402ReportCheck, "status">[]): Safe402CheckStatus {
  if (checks.some(check => check.status === "fail")) {
    return "fail";
  }

  if (checks.some(check => check.status === "warn")) {
    return "warn";
  }

  return "pass";
}

export function formatCheckReport(title: string, checks: Safe402ReportCheck[]): string {
  const summary = summarizeChecks(checks);
  const lines = [
    title,
    `Checks: ${summary.passed} passed, ${summary.failed} failed, ${summary.warnings} warnings`,
    ""
  ];

  for (const check of checks) {
    lines.push(`[${check.status}] ${check.name} - ${check.reason}`);
    if (check.fix && check.status !== "pass") {
      lines.push(`  fix: ${check.fix}`);
    }
  }

  return lines.join("\n");
}
