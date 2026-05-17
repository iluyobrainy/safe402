import type { Safe402AuditReport } from "../audit/index.js";
import type { Safe402ProbeReport } from "../probe/index.js";
import { createAuditJsonReport, createProbeJsonReport } from "./jsonReport.js";

export function formatMarkdownReport(report: Safe402ProbeReport | Safe402AuditReport): string {
  return report.kind === "probe"
    ? formatProbeMarkdownReport(report)
    : formatAuditMarkdownReport(report);
}

export function formatProbeMarkdownReport(report: Safe402ProbeReport): string {
  const json = createProbeJsonReport(report);
  const lines = [
    "# Safe402 Probe Report",
    "",
    `- Report type: \`${json.reportType}\``,
    `- Generated: \`${json.generatedAt}\``,
    `- Target: ${json.targetUrl ?? "n/a"}`,
    `- Method: \`${json.method}\``,
    `- Status: \`${json.status}\``,
    `- x402 detected: \`${json.x402Detected}\``,
    `- Payment requirements found: \`${json.paymentRequirementsFound}\``,
    `- Recommendation: ${json.finalRecommendation}`,
    ""
  ];

  if (json.billing) {
    lines.push("## Billing", "");
    lines.push(`- Product: \`${json.billing.product}\``);
    lines.push(`- Price: ${formatUsd(json.billing.priceUsd)}`);
    lines.push(`- Mode: \`${json.billing.billingMode}\``);
    lines.push(`- Receipt: \`${json.billing.receipt ? "available" : "not available"}\``);
    lines.push("");
  }

  if (json.selectedOption) {
    lines.push("## Selected Option", "");
    lines.push("| Field | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Amount | ${formatUsd(json.selectedOption.amountUsd)} |`);
    lines.push(`| Network | ${json.selectedOption.network ?? ""} |`);
    lines.push(`| Asset | ${json.selectedOption.asset ?? ""} |`);
    lines.push(`| payTo | ${json.selectedOption.payTo ?? ""} |`);
    lines.push(`| Resource | ${json.selectedOption.resource ?? ""} |`);
    lines.push(`| Description | ${escapeTable(json.selectedOption.description ?? "")} |`);
    lines.push(`| Policy decision | \`${json.selectedOption.policyDecision.status}\` |`);
    lines.push("");
  }

  lines.push("## Accepts Options", "");
  if (json.acceptsOptions.length === 0) {
    lines.push("No accepts options were parsed.");
  } else {
    lines.push("| Option | Status | Amount | Network | Asset | payTo | Explanation |");
    lines.push("| ---: | --- | ---: | --- | --- | --- | --- |");
    for (const option of json.acceptsOptions) {
      lines.push(`| ${option.index} | \`${option.status}\` | ${formatUsd(option.amountUsd)} | ${option.network ?? ""} | ${option.asset ?? ""} | ${option.payTo ?? ""} | ${escapeTable(option.explanation)} |`);
    }
  }
  lines.push("");

  if (json.privacyFindings.length > 0 || json.suspiciousFindings.length > 0) {
    lines.push("## Findings", "");
    for (const finding of json.privacyFindings) {
      lines.push(`- Privacy: ${finding.type} in ${finding.field}`);
    }
    for (const finding of json.suspiciousFindings) {
      lines.push(`- Suspicious: ${finding.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatAuditMarkdownReport(report: Safe402AuditReport): string {
  const json = createAuditJsonReport(report);
  const lines = [
    "# Safe402 Audit Report",
    "",
    `- Report type: \`${json.reportType}\``,
    `- Generated: \`${json.generatedAt}\``,
    `- Target: ${json.targetUrl ?? "built-in audit fixture"}`,
    `- Profile: \`${json.profile}\``,
    `- Final verdict: \`${json.finalVerdict}\``,
    `- CI status: \`${json.ciStatus}\``,
    `- Recommendation: ${json.answer}`,
    ""
  ];

  lines.push("## Quote", "");
  lines.push(`- Total: ${json.quote.quoteBased ? "quote-based" : formatUsd(json.quote.totalUsd)}`);
  lines.push(`- Endpoints: \`${json.quote.endpointsCount}\``);
  lines.push(`- Request variants: \`${json.quote.requestVariantsCount}\``);
  lines.push(`- MCP scan: \`${json.quote.mcpScanEnabled}\``);
  lines.push("");

  if (json.billingReceipt) {
    lines.push("## Billing Receipt", "");
    lines.push(`- Mode: \`${json.billingReceipt.mode}\``);
    lines.push(`- Paid: \`${json.billingReceipt.paid}\``);
    lines.push(`- Amount: ${formatUsd(json.billingReceipt.amountUsd)}`);
    lines.push(`- Message: ${json.billingReceipt.message}`);
    lines.push("");
  }

  lines.push("## Test Matrix", "");
  lines.push("| Category | Total | Passed | Warnings | Failed | Critical |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const item of json.testMatrix) {
    lines.push(`| ${item.category} | ${item.total} | ${item.passed} | ${item.warnings} | ${item.failed} | ${item.critical} |`);
  }
  lines.push("");

  lines.push("## Checks", "");
  lines.push("| ID | Severity | Status | Title | Explanation | Recommendation |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const check of json.individualChecks) {
    lines.push(`| \`${check.id}\` | \`${check.severity}\` | \`${check.status}\` | ${escapeTable(check.title)} | ${escapeTable(check.explanation)} | ${escapeTable(check.recommendation ?? "")} |`);
  }
  lines.push("");

  if (json.paymentIntentFingerprint) {
    lines.push("## Payment Intent", "");
    lines.push(`- Fingerprint: \`${json.paymentIntentFingerprint}\``);
    lines.push("");
  }

  addCheckSection(lines, "Repeated Challenge Stability", json.repeatedChallengeStabilityResults);
  addCheckSection(lines, "Retry Loop Simulation", json.retryLoopSimulationResults);
  addCheckSection(lines, "Duplicate Payment Simulation", json.duplicatePaymentSimulationResults);
  addCheckSection(lines, "Metadata And Privacy Findings", json.metadataAndPrivacyFindings);
  addCheckSection(lines, "MCP Findings", json.mcpFindings);

  if (json.remediationChecklist.length > 0) {
    lines.push("## Remediation Checklist", "");
    lines.push(...json.remediationChecklist.map(fix => `- ${fix}`));
    lines.push("");
  }

  return lines.join("\n");
}

function addCheckSection(
  lines: string[],
  title: string,
  checks: Array<{ id: string; severity: string; explanation: string; recommendation?: string }>
) {
  if (checks.length === 0) {
    return;
  }

  lines.push(`## ${title}`, "");
  for (const check of checks) {
    lines.push(`- \`${check.id}\` ${check.severity}: ${check.explanation}`);
    if (check.recommendation) {
      lines.push(`  - Recommendation: ${check.recommendation}`);
    }
  }
  lines.push("");
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatUsd(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : "$unknown";
}
