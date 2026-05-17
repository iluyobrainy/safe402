import {
  additionalPaymentRequired,
  createMemoryReceiptStore,
  type Safe402AdditionalPaymentRequired,
  type Safe402AuditBillingReceipt
} from "../billing/index.js";
import { evaluatePayment } from "../policy/index.js";
import {
  runProbe,
  type Safe402ProbeReport,
  type Safe402ProbeResult
} from "../probe/index.js";
import {
  summarizeChecks,
  type Safe402CheckStatus,
  type Safe402ReportSummary
} from "../reports/index.js";
import { createSafe402Fetch, Safe402Error } from "../runtime.js";
import type {
  Safe402DecisionStatus,
  Safe402PaymentRequirement,
  Safe402Policy,
  Safe402Receipt
} from "../types.js";
import {
  AUDIT_MCP_SERVER_SCAN_USD,
  formatUsd
} from "../pricing.js";
import {
  auditChallengeStability,
  auditChallengeStabilitySnapshots
} from "./checks/challengeStability.js";
import {
  auditCheck,
  statusToSeverity,
  type Safe402AuditCheck,
  type Safe402AuditSeverity
} from "./checks/common.js";
import { auditDuplicatePayment } from "./checks/duplicatePayment.js";
import { auditFacilitator } from "./checks/facilitator.js";
import { auditIdempotency } from "./checks/idempotency.js";
import {
  auditMcp,
  type Safe402McpAuditManifest
} from "./checks/mcp.js";
import {
  auditPaymentIntent,
  auditPaymentIntentMutationSelfTest
} from "./checks/paymentIntent.js";
import { auditPrivacy } from "./checks/privacy.js";
import {
  auditPaidButDeniedStatic,
  auditRetryLoopProtections,
  auditUnpaidServiceRisk
} from "./checks/retryLoop.js";
import { auditValidChallenge } from "./checks/validChallenge.js";
import {
  formatAuditQuote,
  quoteAudit as calculateAuditQuote,
  type Safe402AuditProfile,
  type Safe402AuditQuote
} from "./quote.js";

// Product boundary: an audit is a shipping-readiness safety suite. It includes
// probe as the first live step, then evaluates failure modes that matter after
// money is at risk: challenge mutation, retry loops, missing receipt proof,
// duplicate payments, privacy leakage, paid-but-denied delivery, facilitator
// uncertainty, and MCP paid-tool binding.

export type Safe402AuditStatus = Safe402CheckStatus;
export type { Safe402AuditCheck, Safe402AuditSeverity };

export type Safe402AuditVerdict =
  | "SAFE_TO_PAY"
  | "SAFE_WITH_WARNINGS"
  | "NEEDS_APPROVAL"
  | "NOT_SAFE_TO_AUTOPAY"
  | "INVALID_X402"
  | "INCONCLUSIVE";

export type Safe402AuditCase = {
  name?: string;
  url: string;
  requirement: Safe402PaymentRequirement;
  expect?: Safe402DecisionStatus;
};

export type Safe402AuditSeveritySummary = Record<Safe402AuditSeverity, number>;

export type Safe402AuditOptions = {
  policy?: Safe402Policy;
  endpoints?: string[];
  cases?: Safe402AuditCase[];
  fetch?: typeof fetch;
  profile?: Safe402AuditProfile;
  requestVariants?: number;
  requestInit?: RequestInit;
  timeoutMs?: number;
  mcpServers?: number;
  mcpManifests?: Safe402McpAuditManifest[];
  hostedReport?: boolean;
  quote?: Safe402AuditQuote;
  billing?: Safe402AuditBillingReceipt;
};

export type Safe402AuditReport = {
  kind: "audit";
  reportType: "audit";
  generatedAt: string;
  targetUrl?: string;
  quote: Safe402AuditQuote;
  billing?: Safe402AuditBillingReceipt;
  probeResult?: Safe402ProbeReport;
  additionalPaymentRequired?: Safe402AdditionalPaymentRequired;
  verdict: Safe402AuditVerdict;
  answer: string;
  checks: Safe402AuditCheck[];
  summary: Safe402ReportSummary;
  severitySummary: Safe402AuditSeveritySummary;
  recommendedFixes: string[];
  profile: Safe402AuditProfile;
  endpoints: string[];
  note: string;
};

export type Safe402Audit = {
  run(options?: Safe402AuditOptions): Promise<Safe402AuditReport>;
  quote(options?: Safe402AuditOptions): Safe402AuditQuote;
};

const DEMO_PAY_TO = "0x0000000000000000000000000000000000000000";

const AUDIT_POLICY: Required<Pick<
  Safe402Policy,
  "maxPaymentUsd" |
  "dailyBudgetUsd" |
  "allowedDomains" |
  "allowedNetworks" |
  "allowedAssets" |
  "allowedPayees" |
  "requireApprovalAboveUsd" |
  "duplicateWindowMs" |
  "blockSensitiveMetadata" |
  "requirePaymentResponseHeader" |
  "blockPaymentIntentChanges"
>> = {
  maxPaymentUsd: 0.1,
  dailyBudgetUsd: 0.15,
  allowedDomains: ["api.safe402.test"],
  allowedNetworks: ["base-sepolia"],
  allowedAssets: ["USDC"],
  allowedPayees: [DEMO_PAY_TO],
  requireApprovalAboveUsd: 0.05,
  duplicateWindowMs: 30 * 60 * 1000,
  blockSensitiveMetadata: true,
  requirePaymentResponseHeader: true,
  blockPaymentIntentChanges: true
};

export function createSafe402Audit(defaultOptions: Safe402AuditOptions = {}): Safe402Audit {
  return {
    run(options = {}) {
      return runAudit(mergeAuditOptions(defaultOptions, options));
    },
    quote(options = {}) {
      return quoteAudit(mergeAuditOptions(defaultOptions, options));
    }
  };
}

export async function runAudit(options: Safe402AuditOptions = {}): Promise<Safe402AuditReport> {
  const quote = options.quote ?? quoteAudit(options);
  const profile = quote.profile;
  const endpoints = options.endpoints ?? [];
  const checks: Safe402AuditCheck[] = [];
  let probeReport: Safe402ProbeReport | undefined;

  const extraScope = detectExtraScope({ quote, mcpManifests: options.mcpManifests });
  if (extraScope) {
    checks.push(auditCheck({
      name: "additional audit scope discovered",
      severity: "WARN",
      code: "additional_payment_required",
      category: "policy",
      reason: extraScope.reason,
      fix: extraScope.suggestedAction,
      details: {
        additionalUsd: extraScope.additionalUsd,
        currentQuoteUsd: extraScope.currentQuoteUsd
      }
    }));

    return buildReport({
      quote,
      billing: options.billing,
      additionalPaymentRequired: extraScope,
      checks,
      endpoints
    });
  }

  if (endpoints.length > 0) {
    probeReport = await runProbe({
      policy: options.policy,
      endpoints,
      fetch: options.fetch,
      requestInit: options.requestInit,
      timeoutMs: options.timeoutMs
    });

    checks.push(...probeReport.checks.map(check => ({
      ...check,
      name: `probe: ${check.name}`,
      severity: probeSeverity(check.status, check.details?.category),
      code: probeCode(check.details?.category),
      category: "probe" as const,
      recommendedFix: check.fix
    })));

    for (const probe of probeReport.probes) {
      checks.push(...await auditProbeResult({
        probe,
        profile,
        policy: options.policy ?? {},
        fetch: options.fetch,
        requestInit: options.requestInit,
        timeoutMs: options.timeoutMs
      }));
    }
  } else {
    checks.push(...await runBuiltInAuditChecks(profile));
  }

  for (const auditCase of options.cases ?? []) {
    checks.push(await runCustomCase(auditCase, options.policy ?? {}));
  }

  if (profile === "deep" || options.mcpServers || options.mcpManifests?.length) {
    checks.push(...auditMcp({
      manifests: options.mcpManifests,
      expectedServers: options.mcpServers
    }));
  }

  return buildReport({
    quote,
    billing: options.billing,
    probeReport,
    checks,
    endpoints
  });
}

export const runSafe402Audit = runAudit;

export function quoteAudit(options: Safe402AuditOptions = {}): Safe402AuditQuote {
  return calculateAuditQuote({
    profile: options.profile,
    endpoints: options.endpoints,
    requestVariants: options.requestVariants,
    mcpServers: options.mcpServers ?? options.mcpManifests?.length,
    hostedReport: options.hostedReport,
    customCases: options.cases?.length
  });
}

export function formatAuditReport(report: Safe402AuditReport): string {
  const lines = [
    formatAuditQuote(report.quote),
    "",
    `Verdict: ${report.verdict}`,
    `Answer: ${report.answer}`,
    `Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`,
    `Severity: ${severityLine(report.severitySummary)}`,
    ...(report.billing ? [`Billing: ${report.billing.message}`] : []),
    ""
  ];

  for (const check of report.checks) {
    lines.push(`[${check.severity}] ${check.name} (${check.code}) - ${check.reason}`);
    if (check.recommendedFix && check.severity !== "PASS" && check.severity !== "INFO") {
      lines.push(`  fix: ${check.recommendedFix}`);
    }
  }

  if (report.recommendedFixes.length > 0) {
    lines.push("", "Recommended fixes:");
    lines.push(...report.recommendedFixes.map(fix => `- ${fix}`));
  }

  if (report.additionalPaymentRequired) {
    lines.push(
      "",
      `${report.additionalPaymentRequired.code}: ${report.additionalPaymentRequired.reason}`,
      `Additional amount: ${formatUsd(report.additionalPaymentRequired.additionalUsd)}`,
      `Suggested action: ${report.additionalPaymentRequired.suggestedAction}`
    );
  }

  return lines.join("\n");
}

export {
  formatAuditQuote,
  includedChecksForProfile,
  type Safe402AuditProfile,
  type Safe402AuditQuote,
  type Safe402AuditQuoteLineItem,
  type Safe402AuditQuoteOptions
} from "./quote.js";

export type {
  Safe402McpAuditManifest,
  Safe402McpAuditTool
} from "./checks/mcp.js";

async function auditProbeResult(input: {
  probe: Safe402ProbeResult;
  profile: Safe402AuditProfile;
  policy: Safe402Policy;
  fetch?: typeof fetch;
  requestInit?: RequestInit;
  timeoutMs?: number;
}): Promise<Safe402AuditCheck[]> {
  const checks: Safe402AuditCheck[] = [];
  const requirement = input.probe.selectedOption?.option.requirement ?? input.probe.paymentOptions[0]?.requirement;
  const endpoint = input.probe.url;

  checks.push(auditUnpaidServiceRisk({
    endpoint,
    responseStatus: input.probe.responseStatus
  }));

  if (input.probe.category === "UNREACHABLE" || input.probe.category === "INVALID_X402") {
    checks.push(...auditValidChallenge({
      endpoint,
      probe: input.probe,
      requirement,
      policy: input.policy
    }));
    return checks;
  }

  checks.push(...auditValidChallenge({
    endpoint,
    probe: input.probe,
    requirement,
    policy: input.policy
  }));
  checks.push(...auditPrivacy({ endpoint, requirement }));

  if (input.profile === "standard" || input.profile === "deep") {
    checks.push(...auditIdempotency({ endpoint, requirement, profile: input.profile }));
    if (requirement) {
      checks.push(...auditPaymentIntent({
        endpoint,
        requirement,
        requestInit: input.requestInit
      }));
      checks.push(...await auditDuplicatePayment({
        endpoint,
        requirement,
        policy: input.policy
      }));
    }
    checks.push(...await auditChallengeStability({
      endpoint,
      fetch: input.fetch,
      requestInit: input.requestInit,
      timeoutMs: input.timeoutMs
    }));
    checks.push(...await auditRetryLoopProtections());
  }

  if (input.profile === "deep") {
    checks.push(...auditFacilitator({
      endpoint,
      requirement,
      policy: input.policy
    }));
    checks.push(auditPaidButDeniedStatic({
      endpoint,
      requirement
    }));
  }

  return checks;
}

async function runBuiltInAuditChecks(profile: Safe402AuditProfile): Promise<Safe402AuditCheck[]> {
  const safeRequirement = requirement({
    maxAmountRequired: "10000",
    description: "Safe402 audit fixture. Price is $0.01.",
    paymentIdentifier: "audit-payment-001",
    idempotencyKey: "audit-idempotency-001",
    facilitator: "https://facilitator.safe402.test",
    settlementProof: "audit-settlement-proof"
  });
  const checks: Safe402AuditCheck[] = [];

  checks.push(...auditValidChallenge({
    endpoint: "https://api.safe402.test/paid",
    requirement: safeRequirement,
    policy: AUDIT_POLICY
  }));
  checks.push(...auditPrivacy({
    endpoint: "https://api.safe402.test/paid",
    requirement: safeRequirement
  }));
  checks.push(await expectDecision({
    name: "policy decision allows a normal x402 payment",
    url: "https://api.safe402.test/paid",
    requirement: safeRequirement,
    policy: AUDIT_POLICY,
    expect: "approved"
  }));
  checks.push(await expectDecision({
    name: "policy decision blocks payment above per-call limit",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "250000" }),
    policy: AUDIT_POLICY,
    expect: "denied"
  }));
  checks.push(await expectDecision({
    name: "policy decision blocks disallowed payment domain",
    url: "https://unknown.safe402.test/paid",
    requirement: safeRequirement,
    policy: AUDIT_POLICY,
    expect: "denied"
  }));
  checks.push(await expectDecision({
    name: "policy decision blocks unsupported payment network",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ network: "base", maxAmountRequired: "10000" }),
    policy: AUDIT_POLICY,
    expect: "denied"
  }));
  checks.push(await expectDecision({
    name: "policy decision blocks unsupported payment asset",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ asset: "DAI", maxAmountRequired: "10000" }),
    policy: AUDIT_POLICY,
    expect: "denied"
  }));
  checks.push(await expectDecision({
    name: "policy decision blocks unexpected payTo",
    url: "https://api.safe402.test/paid",
    requirement: requirement({
      maxAmountRequired: "10000",
      payTo: "0x1111111111111111111111111111111111111111"
    }),
    policy: AUDIT_POLICY,
    expect: "denied"
  }));
  checks.push(await expectDecision({
    name: "policy decision requires approval above threshold",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "75000" }),
    policy: AUDIT_POLICY,
    expect: "approval_required"
  }));
  checks.push(await expectDailyBudgetBlock());

  if (profile === "standard" || profile === "deep" || profile === "custom") {
    checks.push(...auditIdempotency({
      endpoint: "https://api.safe402.test/paid",
      requirement: safeRequirement,
      profile
    }));
    checks.push(...auditPaymentIntent({
      endpoint: "https://api.safe402.test/paid",
      requirement: safeRequirement,
      requestInit: { method: "POST", body: "audit-body" }
    }));
    checks.push(auditPaymentIntentMutationSelfTest());
    checks.push(await expectMutatedRetryBlock());
    checks.push(...await auditDuplicatePayment({
      endpoint: "https://api.safe402.test/paid",
      requirement: safeRequirement,
      policy: AUDIT_POLICY
    }));
    checks.push(...auditChallengeStabilitySnapshots("https://api.safe402.test/paid", [
      { responseStatus: 402, requirement: safeRequirement },
      { responseStatus: 402, requirement: safeRequirement },
      { responseStatus: 402, requirement: safeRequirement }
    ]));
    checks.push(...await auditRetryLoopProtections());
  }

  if (profile === "deep" || profile === "custom") {
    checks.push(...auditFacilitator({
      endpoint: "https://api.safe402.test/paid",
      requirement: safeRequirement,
      policy: AUDIT_POLICY
    }));
    checks.push(auditPaidButDeniedStatic({
      endpoint: "https://api.safe402.test/paid",
      requirement: safeRequirement
    }));
    checks.push(...auditMcp({
      manifests: [{
        name: "Safe402 fixture MCP",
        tools: [{
          name: "paid_lookup",
          description: "Paid lookup tool.",
          priceUsd: 0.01,
          paymentRequirement: safeRequirement,
          resultBinding: "tool-call-id"
        }]
      }],
      expectedServers: 1
    }));
  }

  return checks;
}

async function runCustomCase(auditCase: Safe402AuditCase, policy: Safe402Policy): Promise<Safe402AuditCheck> {
  return expectDecision({
    name: auditCase.name ?? `custom case ${auditCase.url}`,
    url: auditCase.url,
    requirement: auditCase.requirement,
    policy,
    expect: auditCase.expect ?? "approved"
  });
}

async function expectDecision(input: {
  name: string;
  url: string;
  requirement: Safe402PaymentRequirement;
  policy: Safe402Policy;
  expect: Safe402DecisionStatus;
  receipts?: Safe402Receipt[];
}): Promise<Safe402AuditCheck> {
  const decision = await evaluatePayment({
    url: new URL(input.url),
    requirement: input.requirement,
    policy: input.policy,
    receipts: createMemoryReceiptStore(input.receipts)
  });

  if (decision.status === input.expect) {
    return auditCheck({
      name: input.name,
      severity: "PASS",
      code: `expected_${input.expect}`,
      category: "policy",
      reason: decision.reason,
      details: { decision: decision.status }
    });
  }

  return auditCheck({
    name: input.name,
    severity: "FAIL",
    code: "unexpected_policy_decision",
    category: "policy",
    reason: `Expected ${input.expect}, got ${decision.status}: ${decision.reason}`,
    fix: "Update policy, payment requirement fields, or the expected audit case outcome so unsafe payments are blocked and safe payments pass.",
    details: { decision: decision.status }
  });
}

async function expectDailyBudgetBlock(): Promise<Safe402AuditCheck> {
  return expectDecision({
    name: "policy decision blocks payment that exceeds daily budget",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "20000" }),
    policy: AUDIT_POLICY,
    expect: "denied",
    receipts: [{
      status: "paid",
      reason: "seeded audit receipt",
      url: "https://api.safe402.test/previous",
      domain: "api.safe402.test",
      amountUsd: 0.14,
      duplicateKey: "previous",
      timestamp: new Date().toISOString()
    }]
  });
}

function buildReport(input: {
  quote: Safe402AuditQuote;
  billing?: Safe402AuditBillingReceipt;
  probeReport?: Safe402ProbeReport;
  additionalPaymentRequired?: Safe402AdditionalPaymentRequired;
  checks: Safe402AuditCheck[];
  endpoints: string[];
}): Safe402AuditReport {
  const summary = summarizeChecks(input.checks);
  const severitySummary = summarizeSeverity(input.checks);
  const verdict = determineVerdict(input.checks, input.additionalPaymentRequired);

  return {
    kind: "audit",
    reportType: "audit",
    generatedAt: new Date().toISOString(),
    targetUrl: input.endpoints[0],
    quote: input.quote,
    billing: input.billing,
    probeResult: input.probeReport,
    additionalPaymentRequired: input.additionalPaymentRequired,
    verdict,
    answer: answerForVerdict(verdict),
    checks: input.checks,
    summary,
    severitySummary,
    recommendedFixes: collectRecommendedFixes(input.checks),
    profile: input.quote.profile,
    endpoints: input.endpoints,
    note: "Safe402 Audit includes probe first, then evaluates x402 failure scenarios and does not silently expand paid scope."
  };
}

function determineVerdict(
  checks: Safe402AuditCheck[],
  extraScope?: Safe402AdditionalPaymentRequired
): Safe402AuditVerdict {
  if (extraScope) {
    return "NEEDS_APPROVAL";
  }

  if (checks.some(check => check.code.includes("unreachable") || check.code === "challenge_unavailable_for_stability")) {
    return "INCONCLUSIVE";
  }

  if (checks.some(check => check.code.includes("invalid_x402") || check.code === "missing_accepts")) {
    return "INVALID_X402";
  }

  if (checks.some(check => check.severity === "CRITICAL")) {
    return "NOT_SAFE_TO_AUTOPAY";
  }

  if (checks.some(check => check.severity === "FAIL")) {
    return "NOT_SAFE_TO_AUTOPAY";
  }

  if (checks.some(check =>
    (check.severity === "WARN" || check.severity === "FAIL" || check.severity === "CRITICAL") &&
    (check.code.includes("approval") || check.code === "additional_payment_required")
  )) {
    return "NEEDS_APPROVAL";
  }

  if (checks.some(check => check.severity === "WARN")) {
    return "SAFE_WITH_WARNINGS";
  }

  return "SAFE_TO_PAY";
}

function answerForVerdict(verdict: Safe402AuditVerdict): string {
  switch (verdict) {
    case "SAFE_TO_PAY":
      return "This x402 payment flow behaves safely under the audited failure conditions.";
    case "SAFE_WITH_WARNINGS":
      return "This x402 payment flow can be paid with caution, but warnings should be fixed before broad autopay.";
    case "NEEDS_APPROVAL":
      return "This x402 payment flow needs explicit approval before continuing.";
    case "NOT_SAFE_TO_AUTOPAY":
      return "This x402 payment flow is not safe for automatic payment under real-world failure conditions.";
    case "INVALID_X402":
      return "This endpoint did not provide a valid x402 challenge.";
    case "INCONCLUSIVE":
      return "Safe402 could not gather enough reliable evidence to decide whether this flow is safe.";
  }
}

function summarizeSeverity(checks: Safe402AuditCheck[]): Safe402AuditSeveritySummary {
  return {
    PASS: checks.filter(check => check.severity === "PASS").length,
    INFO: checks.filter(check => check.severity === "INFO").length,
    WARN: checks.filter(check => check.severity === "WARN").length,
    FAIL: checks.filter(check => check.severity === "FAIL").length,
    CRITICAL: checks.filter(check => check.severity === "CRITICAL").length
  };
}

function collectRecommendedFixes(checks: Safe402AuditCheck[]): string[] {
  const fixes = checks
    .filter(check => check.severity !== "PASS" && check.severity !== "INFO")
    .map(check => check.recommendedFix ?? check.fix)
    .filter((fix): fix is string => Boolean(fix));

  return Array.from(new Set(fixes));
}

function probeSeverity(status: Safe402CheckStatus, category: unknown): Safe402AuditSeverity {
  if (category === "UNREACHABLE") {
    return "FAIL";
  }

  if (category === "INVALID_X402") {
    return "CRITICAL";
  }

  if (category === "BLOCKED_BY_POLICY" || category === "NEEDS_APPROVAL") {
    return "WARN";
  }

  return statusToSeverity(status);
}

function probeCode(category: unknown): string {
  if (typeof category === "string") {
    return `probe_${category.toLowerCase()}`;
  }

  return "probe_check";
}

function severityLine(summary: Safe402AuditSeveritySummary): string {
  return `PASS ${summary.PASS}, INFO ${summary.INFO}, WARN ${summary.WARN}, FAIL ${summary.FAIL}, CRITICAL ${summary.CRITICAL}`;
}

function detectExtraScope(input: {
  quote: Safe402AuditQuote;
  mcpManifests?: Safe402McpAuditManifest[];
}): Safe402AdditionalPaymentRequired | undefined {
  const manifestCount = input.mcpManifests?.length ?? 0;

  if (manifestCount > input.quote.mcpServersCount) {
    const missingServers = manifestCount - input.quote.mcpServersCount;
    return additionalPaymentRequired({
      currentQuoteUsd: input.quote.totalUsd,
      additionalUsd: missingServers * AUDIT_MCP_SERVER_SCAN_USD,
      reason: `Audit received ${manifestCount} MCP manifest${manifestCount === 1 ? "" : "s"}, but the quote only covered ${input.quote.mcpServersCount}.`
    });
  }

  return undefined;
}

async function expectMutatedRetryBlock(): Promise<Safe402AuditCheck> {
  const init: RequestInit = {
    method: "POST",
    body: "stable-body"
  };
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({
      accepts: [requirement({ maxAmountRequired: "75000" })]
    }), { status: 402 }),
    paidFetch: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "PAYMENT-RESPONSE": "demo" }
    }),
    policy: {
      ...AUDIT_POLICY,
      blockPaymentIntentChanges: true
    },
    onApprovalRequired: async () => {
      init.body = "mutated-body";
      return true;
    }
  });

  try {
    await safeFetch("https://api.safe402.test/paid", init);
  } catch (error) {
    if (error instanceof Safe402Error && error.decision.status === "failed") {
      return auditCheck({
        name: "method and body mutation risk runtime block",
        severity: "PASS",
        code: "mutated_retry_body_blocked",
        category: "payment_intent",
        reason: error.decision.reason,
        details: { decision: error.decision.status }
      });
    }
  }

  return auditCheck({
    name: "method and body mutation risk runtime block",
    severity: "CRITICAL",
    code: "mutated_retry_body_allowed",
    category: "payment_intent",
    reason: "Mutated retry body was not blocked.",
    fix: "Compare request intent before the 402 challenge and before paid retry."
  });
}

function requirement(overrides: Partial<Safe402PaymentRequirement>): Safe402PaymentRequirement {
  return {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    payTo: DEMO_PAY_TO,
    maxAmountRequired: "10000",
    resource: "https://api.safe402.test/paid",
    ...overrides
  };
}

function mergeAuditOptions(base: Safe402AuditOptions, next: Safe402AuditOptions): Safe402AuditOptions {
  return {
    ...base,
    ...next,
    endpoints: next.endpoints ?? base.endpoints,
    cases: next.cases ?? base.cases,
    mcpManifests: next.mcpManifests ?? base.mcpManifests,
    requestInit: next.requestInit ?? base.requestInit
  };
}
