import type {
  Safe402AuditCheck,
  Safe402AuditReport,
  Safe402AuditSeverity,
  Safe402AuditVerdict
} from "../audit/index.js";
import type {
  Safe402EvaluatedProbeOption,
  Safe402ProbeDecisionCategory,
  Safe402ProbeReport,
  Safe402ProbeResult
} from "../probe/index.js";
import type {
  Safe402PaymentRequirement,
  Safe402PrivacyFinding
} from "../types.js";

export type Safe402ReportJson = Safe402ProbeJsonReport | Safe402AuditJsonReport;

export type Safe402JsonReportOptions = {
  generatedAt?: string;
};

export type Safe402ProbeJsonReport = Omit<Safe402ProbeReport, "billing"> & {
  reportType: "probe";
  kind: "probe";
  generatedAt: string;
  targetUrl?: string;
  targets: string[];
  method: string;
  status: Safe402ProbeDecisionCategory | "NO_TARGETS";
  x402Detected: boolean;
  paymentRequirementsFound: number;
  acceptsOptions: Safe402JsonAcceptsOption[];
  selectedOption?: Safe402JsonAcceptsOption;
  amountUsd?: number;
  network?: string;
  asset?: string;
  payTo?: string;
  resource?: string;
  description?: string;
  policyDecision?: Safe402JsonPolicyDecision;
  privacyFindings: Safe402PrivacyFinding[];
  suspiciousFindings: Safe402JsonSuspiciousFinding[];
  billing?: Safe402JsonProbeBilling;
  finalRecommendation: string;
};

export type Safe402JsonAcceptsOption = {
  index: number;
  source: string;
  status: Safe402ProbeDecisionCategory;
  amountUsd: number;
  network?: string;
  asset?: string;
  payTo?: string;
  resource?: string;
  description?: string;
  policyDecision: Safe402JsonPolicyDecision;
  privacyFindings: Safe402PrivacyFinding[];
  suspiciousFindings: Safe402JsonSuspiciousFinding[];
  explanation: string;
};

export type Safe402JsonPolicyDecision = {
  status: string;
  allowed: boolean;
  reason: string;
  reasons: Array<{ code: string; message: string }>;
};

export type Safe402JsonSuspiciousFinding = {
  code: string;
  message: string;
  severity?: string;
  field?: string;
  type?: string;
  value?: string;
};

export type Safe402JsonProbeBilling = {
  product: "probe";
  priceUsd: number;
  billingMode: string;
  mode?: string;
  paid?: boolean;
  receipt?: unknown;
} & Record<string, unknown>;

export type Safe402AuditJsonReport = Omit<Safe402AuditReport, "checks" | "billing" | "probeResult"> & {
  reportType: "audit";
  kind: "audit";
  generatedAt: string;
  targetUrl?: string;
  targets: string[];
  profile: string;
  quote: Safe402AuditReport["quote"];
  billing?: Safe402AuditReport["billing"];
  billingReceipt?: Safe402AuditReport["billing"];
  probeResult?: Safe402ProbeJsonReport;
  testMatrix: Safe402JsonAuditTestMatrixEntry[];
  checks: Safe402JsonAuditCheck[];
  individualChecks: Safe402JsonAuditCheck[];
  paymentIntentFingerprint?: string;
  repeatedChallengeStabilityResults: Safe402JsonAuditCheck[];
  retryLoopSimulationResults: Safe402JsonAuditCheck[];
  duplicatePaymentSimulationResults: Safe402JsonAuditCheck[];
  metadataAndPrivacyFindings: Safe402JsonAuditCheck[];
  mcpFindings: Safe402JsonAuditCheck[];
  finalVerdict: Safe402AuditVerdict;
  remediationChecklist: string[];
  ciStatus: "pass" | "fail";
};

export type Safe402JsonAuditCheck = {
  id: string;
  code: string;
  title: string;
  severity: Safe402AuditSeverity;
  status: string;
  evidence: Record<string, unknown>;
  explanation: string;
  recommendation?: string;
  category: string;
  endpoint?: string;
};

export type Safe402JsonAuditTestMatrixEntry = {
  category: string;
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  critical: number;
};

export function createJsonReport(
  report: Safe402ProbeReport | Safe402AuditReport,
  options: Safe402JsonReportOptions = {}
): Safe402ReportJson {
  return report.kind === "probe"
    ? createProbeJsonReport(report, options)
    : createAuditJsonReport(report, options);
}

export function createProbeJsonReport(
  report: Safe402ProbeReport,
  options: Safe402JsonReportOptions = {}
): Safe402ProbeJsonReport {
  const generatedAt = options.generatedAt ?? report.generatedAt ?? new Date().toISOString();
  const method = report.method ?? "GET";
  const primary = report.probes[0];
  const selected = primary?.selectedOption;
  const requirement = selected?.option.requirement ?? primary?.paymentOptions[0]?.requirement;
  const acceptsOptions = report.probes.flatMap(probe => probe.options.map(toJsonAcceptsOption));
  const selectedOption = selected ? toJsonAcceptsOption(selected) : undefined;
  const privacyFindings = report.probes.flatMap(probe => probe.options.flatMap(option => option.privacyFindings));
  const suspiciousFindings = report.probes.flatMap(probe => probe.options.flatMap(option => suspiciousFindingsForOption(option)));
  const targetUrl = report.targetUrl ?? primary?.url;

  return {
    ...report,
    reportType: "probe",
    kind: "probe",
    generatedAt,
    targetUrl,
    targets: report.targets ?? report.probes.map(probe => probe.url),
    method,
    status: primary?.category ?? "NO_TARGETS",
    x402Detected: report.probes.some(probe => probe.paymentOptions.length > 0),
    paymentRequirementsFound: report.probes.reduce((sum, probe) => sum + probe.paymentOptions.length, 0),
    acceptsOptions,
    selectedOption,
    amountUsd: selected?.amountUsd,
    network: stringValue(requirement?.network ?? requirement?.chain),
    asset: stringValue(requirement?.asset),
    payTo: stringValue(requirement?.payTo ?? requirement?.payee ?? requirement?.recipient ?? requirement?.to),
    resource: stringValue(requirement?.resource ?? requirement?.url),
    description: stringValue(requirement?.description ?? requirement?.reason),
    policyDecision: selected ? policyDecisionForOption(selected) : undefined,
    privacyFindings,
    suspiciousFindings,
    billing: report.billing
      ? {
        ...report.billing,
        product: "probe",
        priceUsd: report.billing.amountUsd ?? report.pricing.totalUsd,
        billingMode: report.billing.mode,
        receipt: report.billing
      }
      : {
        product: "probe",
        priceUsd: report.pricing.totalUsd,
        billingMode: "disabled",
        mode: "disabled",
        paid: false
      },
    finalRecommendation: finalProbeRecommendation(primary)
  };
}

export function createAuditJsonReport(
  report: Safe402AuditReport,
  options: Safe402JsonReportOptions = {}
): Safe402AuditJsonReport {
  const generatedAt = options.generatedAt ?? report.generatedAt ?? new Date().toISOString();
  const checks = report.checks.map(toJsonAuditCheck);

  return {
    ...report,
    reportType: "audit",
    kind: "audit",
    generatedAt,
    targetUrl: report.targetUrl ?? report.endpoints[0],
    targets: report.endpoints,
    profile: report.profile,
    quote: report.quote,
    billing: report.billing,
    billingReceipt: report.billing,
    probeResult: report.probeResult ? createProbeJsonReport(report.probeResult, { generatedAt }) : undefined,
    testMatrix: buildTestMatrix(report.checks),
    checks,
    individualChecks: checks,
    paymentIntentFingerprint: firstStringDetail(report.checks, "fingerprint"),
    repeatedChallengeStabilityResults: checks.filter(check => check.category === "stability"),
    retryLoopSimulationResults: checks.filter(check => check.category === "retry"),
    duplicatePaymentSimulationResults: checks.filter(check => check.category === "duplicate"),
    metadataAndPrivacyFindings: checks.filter(check => check.category === "privacy"),
    mcpFindings: checks.filter(check => check.category === "mcp"),
    finalVerdict: report.verdict,
    remediationChecklist: report.recommendedFixes,
    ciStatus: report.summary.failed > 0 ? "fail" : "pass"
  };
}

export function finalProbeRecommendation(probe: Safe402ProbeResult | undefined): string {
  if (!probe) {
    return "No probe target was provided.";
  }

  switch (probe.category) {
    case "APPROVED":
      return "Payment requirement matches policy.";
    case "NEEDS_APPROVAL":
      return "Payment may be valid but exceeds the approval threshold. Ask for human approval before paying.";
    case "BLOCKED_BY_POLICY":
      return blockedByPolicyLanguage(probe.selectedOption) ?? "Blocked by policy. The payment requirement is not allowed by your current Safe402 policy. This does not mean the provider is malicious.";
    case "SUSPICIOUS":
      return "Payment data is inconsistent or risky. Review the suspicious findings before paying.";
    case "INVALID_X402":
      return "Endpoint did not return a valid x402 payment challenge.";
    case "FREE_OR_NOT_GATED":
      return "Endpoint returned success without a payment challenge.";
    case "UNREACHABLE":
      return "Endpoint could not be reached.";
  }
}

export function blockedByPolicyLanguage(option: Safe402EvaluatedProbeOption | undefined): string | undefined {
  if (!option) {
    return undefined;
  }

  const maxReason = option.policy.reasons.find(reason => reason.code === "max_payment_exceeded");
  const maxAutoSpendUsd = maxReason ? extractLastNumber(maxReason.message) : undefined;

  if (maxAutoSpendUsd !== undefined) {
    return `Blocked by policy. Endpoint requested ${formatUsd(option.amountUsd)}, but your max auto-spend is ${formatUsd(maxAutoSpendUsd)}. This does not mean the provider is malicious.`;
  }

  return `Blocked by policy. Endpoint requested ${formatUsd(option.amountUsd)}, but your Safe402 policy does not allow this payment. This does not mean the provider is malicious.`;
}

function toJsonAcceptsOption(option: Safe402EvaluatedProbeOption): Safe402JsonAcceptsOption {
  const requirement = option.option.requirement;

  return {
    index: option.option.index + 1,
    source: option.option.source,
    status: option.category,
    amountUsd: option.amountUsd,
    network: stringValue(requirement.network ?? requirement.chain),
    asset: stringValue(requirement.asset),
    payTo: stringValue(requirement.payTo ?? requirement.payee ?? requirement.recipient ?? requirement.to),
    resource: stringValue(requirement.resource ?? requirement.url),
    description: stringValue(requirement.description ?? requirement.reason),
    policyDecision: policyDecisionForOption(option),
    privacyFindings: option.privacyFindings,
    suspiciousFindings: suspiciousFindingsForOption(option),
    explanation: option.explanation
  };
}

function policyDecisionForOption(option: Safe402EvaluatedProbeOption): Safe402JsonPolicyDecision {
  return {
    status: option.policy.status,
    allowed: option.policy.allowed,
    reason: option.policy.reason,
    reasons: option.policy.reasons
  };
}

function suspiciousFindingsForOption(option: Safe402EvaluatedProbeOption): Safe402JsonSuspiciousFinding[] {
  return [
    ...option.amountAmbiguityFindings
      .filter(finding => finding.severity === "suspicious")
      .map(finding => ({
        code: finding.code,
        message: finding.message,
        severity: finding.severity
      })),
    ...option.privacyFindings.map(finding => ({
      code: finding.type,
      message: `Sensitive metadata detected in ${finding.field}: ${finding.type}.`,
      field: finding.field,
      type: finding.type,
      value: finding.value
    }))
  ];
}

function toJsonAuditCheck(check: Safe402AuditCheck): Safe402JsonAuditCheck {
  return {
    id: auditCheckId(check),
    code: check.code,
    title: check.name,
    severity: check.severity,
    status: check.status,
    evidence: {
      ...(check.details ?? {}),
      ...(check.endpoint ? { endpoint: check.endpoint } : {})
    },
    explanation: check.reason,
    recommendation: check.recommendedFix ?? check.fix,
    category: check.category,
    endpoint: check.endpoint
  };
}

function auditCheckId(check: Safe402AuditCheck): string {
  const mapped = AUDIT_CHECK_ID_BY_CODE[check.code];
  if (mapped) {
    return mapped;
  }

  if (check.category === "payment_intent") {
    return "PAYMENT_INTENT_STABLE";
  }

  if (check.category === "retry") {
    return check.code.includes("payment_response") || check.code.includes("x_payment_response")
      ? "PAYMENT_RESPONSE_PRESENT"
      : "RETRY_LOOP_RISK";
  }

  if (check.category === "duplicate") {
    return check.code.includes("payment_identifier")
      ? "PAYMENT_IDENTIFIER_PRESENT"
      : "DUPLICATE_PAYMENT_RISK";
  }

  if (check.category === "privacy") {
    return "NO_PII_IN_METADATA";
  }

  if (check.category === "mcp") {
    return check.code.includes("price") ? "MCP_PRICE_MATCH" : "MCP_TOOL_AVAILABLE";
  }

  if (check.category === "facilitator") {
    return check.code.includes("declared") || check.code.includes("present")
      ? "FACILITATOR_DECLARED"
      : "FACILITATOR_RISK";
  }

  return check.code.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function buildTestMatrix(checks: Safe402AuditCheck[]): Safe402JsonAuditTestMatrixEntry[] {
  const categories = Array.from(new Set(checks.map(check => check.category))).sort();

  return categories.map(category => {
    const categoryChecks = checks.filter(check => check.category === category);
    return {
      category,
      total: categoryChecks.length,
      passed: categoryChecks.filter(check => check.status === "pass").length,
      warnings: categoryChecks.filter(check => check.status === "warn").length,
      failed: categoryChecks.filter(check => check.status === "fail").length,
      critical: categoryChecks.filter(check => check.severity === "CRITICAL").length
    };
  });
}

function firstStringDetail(checks: Safe402AuditCheck[], key: string): string | undefined {
  for (const check of checks) {
    const value = check.details?.[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function extractLastNumber(value: string): number | undefined {
  const matches = Array.from(value.matchAll(/\d+(?:\.\d+)?/g));
  const last = matches.at(-1)?.[0];
  if (!last) {
    return undefined;
  }

  const parsed = Number(last);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatUsd(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : "$unknown";
}

const AUDIT_CHECK_ID_BY_CODE: Record<string, string> = {
  valid_x402_challenge: "VALID_402_CHALLENGE",
  invalid_x402_challenge: "VALID_402_CHALLENGE",
  missing_accepts: "ACCEPTS_OPTIONS_PARSED",
  single_accept: "ACCEPTS_OPTIONS_PARSED",
  multiple_accepts_supported: "ACCEPTS_OPTIONS_PARSED",
  accepts_options_diverge: "ACCEPTS_OPTIONS_PARSED",
  invalid_amount: "VALID_PAYMENT_REQUIREMENT",
  price_amount_consistent: "HUMAN_MACHINE_PRICE_MATCH",
  description_price_mismatch: "HUMAN_MACHINE_PRICE_MATCH",
  amount_field_mismatch: "HUMAN_MACHINE_PRICE_MATCH",
  supported_chain: "CHAIN_ALLOWED",
  unsupported_chain: "CHAIN_ALLOWED",
  missing_network: "CHAIN_ALLOWED",
  supported_asset: "ASSET_ALLOWED",
  unsupported_asset: "ASSET_ALLOWED",
  missing_asset: "ASSET_ALLOWED",
  expected_pay_to: "PAYTO_PRESENT",
  unexpected_pay_to: "PAYTO_PRESENT",
  missing_pay_to: "PAYTO_PRESENT",
  pay_to_stable: "PAYTO_STABLE",
  pay_to_changed: "PAYTO_STABLE",
  payTo_missing: "PAYTO_PRESENT",
  amount_stable: "AMOUNT_STABLE",
  amount_changed: "AMOUNT_STABLE",
  resource_stable: "RESOURCE_STABLE",
  resource_changed: "RESOURCE_STABLE",
  payment_intent_fingerprint: "PAYMENT_INTENT_STABLE",
  payment_intent_incomplete: "PAYMENT_INTENT_STABLE",
  body_mutation_changes_intent: "PAYMENT_INTENT_STABLE",
  body_mutation_not_fingerprinted: "PAYMENT_INTENT_STABLE",
  description_privacy_clean: "NO_PII_IN_METADATA",
  description_leaks_sensitive_metadata: "NO_PII_IN_METADATA",
  resource_privacy_clean: "NO_PII_IN_METADATA",
  resource_leaks_sensitive_metadata: "NO_PII_IN_METADATA",
  reason_privacy_clean: "NO_PII_IN_METADATA",
  reason_leaks_sensitive_metadata: "NO_PII_IN_METADATA",
  metadata_secret_clean: "NO_PII_IN_METADATA",
  api_key_in_metadata: "NO_PII_IN_METADATA",
  wallet_metadata_clean: "NO_PII_IN_METADATA",
  wallet_linked_metadata: "NO_PII_IN_METADATA",
  payment_identifier_present: "PAYMENT_IDENTIFIER_PRESENT",
  payment_identifier_missing: "PAYMENT_IDENTIFIER_PRESENT",
  repeated_402_retry_fused: "RETRY_LOOP_RISK",
  repeated_402_retry_loop: "RETRY_LOOP_RISK",
  duplicate_retry_blocked: "DUPLICATE_PAYMENT_RISK",
  duplicate_retry_payable: "DUPLICATE_PAYMENT_RISK",
  missing_payment_response_blocked: "PAYMENT_RESPONSE_PRESENT",
  missing_payment_response_allowed: "PAYMENT_RESPONSE_PRESENT",
  x_payment_response_accepted: "PAYMENT_RESPONSE_PRESENT",
  paid_but_denied_blocked: "PAID_BUT_DENIED_RISK",
  paid_but_denied_allowed: "PAID_BUT_DENIED_RISK",
  service_delivery_unverifiable: "PAID_BUT_DENIED_RISK",
  service_delivery_not_verified: "PAID_BUT_DENIED_RISK",
  unpaid_service_possible: "UNPAID_SERVICE_RISK",
  unpaid_service_not_observed: "UNPAID_SERVICE_RISK",
  mcp_paid_manifest_present: "MCP_TOOL_AVAILABLE",
  mcp_tool_unavailable: "MCP_TOOL_AVAILABLE",
  mcp_tool_removed_after_discovery: "MCP_TOOL_AVAILABLE",
  mcp_tool_price_mismatch: "MCP_PRICE_MATCH",
  facilitator_declared: "FACILITATOR_DECLARED",
  facilitator_missing: "FACILITATOR_DECLARED",
  facilitator_url_suspicious: "FACILITATOR_RISK"
};
