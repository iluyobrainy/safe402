import type { Safe402AuditReport } from "../audit/index.js";
import type { Safe402ProbeReport } from "../probe/index.js";
import { createAuditJsonReport, createProbeJsonReport } from "./jsonReport.js";

export function formatConsoleReport(report: Safe402ProbeReport | Safe402AuditReport): string {
  return report.kind === "probe"
    ? formatProbeConsoleReport(report)
    : formatAuditConsoleReport(report);
}

export function formatProbeConsoleReport(report: Safe402ProbeReport): string {
  const json = createProbeJsonReport(report);
  const lines = [
    "Safe402 Probe Report",
    `Generated: ${json.generatedAt}`,
    `Target: ${json.targetUrl ?? "n/a"}`,
    `Method: ${json.method}`,
    `Status: ${json.status}`,
    `x402 detected: ${json.x402Detected ? "yes" : "no"}`,
    `Payment requirements: ${json.paymentRequirementsFound}`,
    `Recommendation: ${json.finalRecommendation}`
  ];

  if (json.billing) {
    lines.push(`Billing: ${json.billing.product} ${formatUsd(json.billing.priceUsd)} (${json.billing.billingMode})`);
  }

  if (json.selectedOption) {
    lines.push(
      `Selected: ${formatUsd(json.selectedOption.amountUsd)} ${json.selectedOption.asset ?? "asset unknown"} on ${json.selectedOption.network ?? "network unknown"} to ${json.selectedOption.payTo ?? "payTo unknown"}`
    );
  }

  if (json.acceptsOptions.length > 0) {
    lines.push("", "Accepts options:");
    for (const option of json.acceptsOptions) {
      lines.push(`- #${option.index} ${option.status}: ${formatUsd(option.amountUsd)} ${option.asset ?? ""} ${option.network ?? ""} ${option.payTo ?? ""}`.trim());
      lines.push(`  ${option.explanation}`);
    }
  }

  if (json.suspiciousFindings.length > 0) {
    lines.push("", "Suspicious findings:");
    for (const finding of json.suspiciousFindings) {
      lines.push(`- ${finding.message}`);
    }
  }

  return lines.join("\n");
}

export function formatAuditConsoleReport(report: Safe402AuditReport): string {
  const json = createAuditJsonReport(report);
  const lines = [
    "Safe402 Audit Report",
    `Generated: ${json.generatedAt}`,
    `Target: ${json.targetUrl ?? "built-in audit fixture"}`,
    `Profile: ${json.profile}`,
    `Quote: ${json.quote.quoteBased ? "quote-based" : formatUsd(json.quote.totalUsd)}`,
    `Verdict: ${json.finalVerdict}`,
    `CI status: ${json.ciStatus}`,
    `Answer: ${json.answer}`,
    `Checks: ${json.summary.passed} passed, ${json.summary.failed} failed, ${json.summary.warnings} warnings`
  ];

  if (json.billingReceipt) {
    lines.push(`Billing: ${json.billingReceipt.message}`);
  }

  lines.push("", "Test matrix:");
  for (const item of json.testMatrix) {
    lines.push(`- ${item.category}: ${item.passed} passed, ${item.warnings} warnings, ${item.failed} failed`);
  }

  lines.push("", "Checks:");
  for (const check of json.individualChecks) {
    lines.push(`[${check.severity}] ${check.id} - ${check.title}: ${check.explanation}`);
    if (check.recommendation && check.status !== "pass") {
      lines.push(`  recommendation: ${check.recommendation}`);
    }
  }

  if (json.paymentIntentFingerprint) {
    lines.push("", `Payment intent fingerprint: ${json.paymentIntentFingerprint}`);
  }

  if (json.remediationChecklist.length > 0) {
    lines.push("", "Remediation checklist:");
    lines.push(...json.remediationChecklist.map(fix => `- ${fix}`));
  }

  return lines.join("\n");
}

function formatUsd(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : "$unknown";
}
