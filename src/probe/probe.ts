import { createMemoryReceiptStore } from "../billing/index.js";
import {
  formatCheckReport,
  summarizeChecks,
  type Safe402ReportCheck,
  type Safe402ReportSummary
} from "../reports/index.js";
import type {
  Safe402Decision,
  Safe402PaymentRequirement,
  Safe402Policy,
  Safe402ReceiptStore
} from "../types.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import {
  categorizeNetworkError,
  categorizeNonX402Status,
  evaluateProbe,
  type Safe402EvaluatedProbeOption,
  type Safe402NonX402Status,
  type Safe402ProbeDecisionCategory
} from "./evaluateProbe.js";
import {
  extractPaymentRequirements,
  type Safe402RequirementExtraction
} from "./extractRequirement.js";
import {
  normalizeAcceptOptions,
  type Safe402ProbePaymentOption
} from "./multiAccept.js";

// Product boundary: a probe is an unpaid inspection of one or more x402
// challenges. It answers "what would this endpoint ask my agent to pay, and
// does that match policy?" It never requires a private key, never signs a
// payment, and never sends funds. Audit owns simulated failure scenarios.

export type Safe402ProbeCheck = Safe402ReportCheck;
export type Safe402ProbeStatus = "pass" | "fail" | "warn";

export type Safe402ProbeOptions = {
  policy?: Safe402Policy;
  endpoints?: string[];
  fetch?: typeof fetch;
  receipts?: Safe402ReceiptStore;
  timeoutMs?: number;
  requestInit?: RequestInit;
};

export type Safe402ProbeResult = {
  url: string;
  status: Safe402ProbeStatus;
  category: Safe402ProbeDecisionCategory;
  explanation: string;
  responseStatus?: number;
  nonX402Status?: Safe402NonX402Status;
  requirement?: Safe402PaymentRequirement;
  decision?: Safe402Decision;
  selectedOption?: Safe402EvaluatedProbeOption;
  options: Safe402EvaluatedProbeOption[];
  paymentOptions: Safe402ProbePaymentOption[];
  extraction?: Safe402RequirementExtraction;
  checks: Safe402ProbeCheck[];
};

export type Safe402ProbeReport = {
  kind: "probe";
  probes: Safe402ProbeResult[];
  checks: Safe402ProbeCheck[];
  summary: Safe402ReportSummary;
  note: string;
};

export type Safe402ProbeQuote = {
  kind: "probe";
  unpaid: true;
  endpointCount: number;
  estimatedPayments: 0;
  checks: string[];
  note: string;
};

export type Safe402Probe = {
  run(options?: Safe402ProbeOptions): Promise<Safe402ProbeReport>;
  quote(options?: Safe402ProbeOptions): Safe402ProbeQuote;
};

export function createSafe402Probe(defaultOptions: Safe402ProbeOptions = {}): Safe402Probe {
  return {
    run(options = {}) {
      return runProbe(mergeProbeOptions(defaultOptions, options));
    },
    quote(options = {}) {
      return quoteProbe(mergeProbeOptions(defaultOptions, options));
    }
  };
}

export async function runProbe(options: Safe402ProbeOptions = {}): Promise<Safe402ProbeReport> {
  const probes: Safe402ProbeResult[] = [];

  for (const endpoint of options.endpoints ?? []) {
    probes.push(await probeEndpoint(endpoint, options));
  }

  const checks = probes.flatMap(probe => probe.checks);

  return {
    kind: "probe",
    probes,
    checks,
    summary: summarizeChecks(checks),
    note: "Probe performs unpaid x402 endpoint inspection and policy evaluation only."
  };
}

export async function probeEndpoint(
  endpoint: string,
  options: Omit<Safe402ProbeOptions, "endpoints"> = {}
): Promise<Safe402ProbeResult> {
  const policy = options.policy ?? {};
  const receipts = options.receipts ?? createMemoryReceiptStore();
  const checks: Safe402ProbeCheck[] = [];
  const url = new URL(endpoint);

  try {
    const response = await fetchWithTimeout(endpoint, {
      ...(options.requestInit ?? {}),
      fetch: options.fetch,
      timeoutMs: options.timeoutMs
    });

    if (response.status !== 402) {
      const nonX402 = categorizeNonX402Status(response.status);
      checks.push({
        name: `endpoint preflight ${endpoint}`,
        status: categoryToCheckStatus(nonX402.category),
        reason: nonX402.explanation,
        fix: nonX402.category === "FREE_OR_NOT_GATED"
          ? undefined
          : "Point the probe at an x402-protected resource that returns a 402 Payment Required challenge before payment.",
        details: {
          category: nonX402.category,
          nonX402Status: nonX402.status,
          responseStatus: response.status
        }
      });

      return {
        url: endpoint,
        status: categoryToCheckStatus(nonX402.category),
        category: nonX402.category,
        explanation: nonX402.explanation,
        responseStatus: response.status,
        nonX402Status: nonX402.status,
        options: [],
        paymentOptions: [],
        checks
      };
    }

    const extraction = await extractPaymentRequirements(response);
    const paymentOptions = normalizeAcceptOptions(extraction.requirements, policy);
    const evaluation = await evaluateProbe({
      url,
      options: paymentOptions,
      policy,
      receipts
    });

    checks.push(...checksFromEvaluation(endpoint, evaluation.options));

    if (evaluation.options.length === 0) {
      checks.push({
        name: `endpoint x402 requirement ${endpoint}`,
        status: "fail",
        reason: evaluation.explanation,
        fix: "Return a valid x402 payment requirement in PAYMENT-REQUIRED, X-PAYMENT-REQUIRED, WWW-Authenticate, or a body accepts array.",
        details: {
          category: evaluation.category,
          invalidReasons: extraction.invalidReasons
        }
      });
    }

    return {
      url: endpoint,
      status: categoryToCheckStatus(evaluation.category),
      category: evaluation.category,
      explanation: evaluation.explanation,
      responseStatus: response.status,
      requirement: evaluation.selectedOption?.option.requirement,
      decision: evaluation.selectedOption ? legacyDecision(endpoint, url, evaluation.selectedOption) : undefined,
      selectedOption: evaluation.selectedOption,
      options: evaluation.options,
      paymentOptions,
      extraction,
      checks
    };
  } catch (error) {
    const network = categorizeNetworkError(error);
    checks.push({
      name: `endpoint preflight ${endpoint}`,
      status: "fail",
      reason: network.explanation,
      fix: "Check the endpoint URL, local server, network, and whether the endpoint is reachable before probing.",
      details: {
        category: network.category,
        nonX402Status: network.status
      }
    });

    return {
      url: endpoint,
      status: "fail",
      category: network.category,
      explanation: network.explanation,
      nonX402Status: network.status,
      options: [],
      paymentOptions: [],
      checks
    };
  }
}

export function quoteProbe(options: Safe402ProbeOptions = {}): Safe402ProbeQuote {
  return {
    kind: "probe",
    unpaid: true,
    endpointCount: options.endpoints?.length ?? 0,
    estimatedPayments: 0,
    checks: [
      "unpaid endpoint request",
      "402 payment challenge capture",
      "PAYMENT-REQUIRED, X-PAYMENT-REQUIRED, WWW-Authenticate, and body extraction",
      "all accepts options evaluation",
      "policy evaluation",
      "amount ambiguity detection",
      "metadata privacy scan"
    ],
    note: "A Safe402 probe does not require a private key, sign payment data, settle payment, or retry a paid request."
  };
}

export function formatProbeReport(report: Safe402ProbeReport): string {
  const lines = [
    formatCheckReport("Safe402 probe", report.checks),
    ""
  ];

  for (const probe of report.probes) {
    lines.push(`${probe.url}`);
    lines.push(`  decision: ${probe.category}`);
    lines.push(`  summary: ${probe.explanation}`);
    if (probe.selectedOption) {
      lines.push(`  selected: option ${probe.selectedOption.option.index + 1}, ${formatUsd(probe.selectedOption.amountUsd)}, ${probe.selectedOption.option.requirement.asset ?? "unknown asset"}`);
    }
    if (probe.options.length > 1) {
      lines.push(`  accepts: ${probe.options.length} options evaluated`);
    }
  }

  return lines.join("\n");
}

export function formatProbeMarkdownReport(report: Safe402ProbeReport): string {
  const lines = [
    "# Safe402 Probe Report",
    "",
    `Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`,
    ""
  ];

  for (const probe of report.probes) {
    lines.push(`## ${probe.url}`);
    lines.push("");
    lines.push(`- Decision: \`${probe.category}\``);
    lines.push(`- Explanation: ${probe.explanation}`);
    if (probe.responseStatus !== undefined) {
      lines.push(`- HTTP status: \`${probe.responseStatus}\``);
    }
    if (probe.options.length > 0) {
      lines.push("");
      lines.push("| Option | Category | Amount | Asset | Network | Payee | Reason |");
      lines.push("| --- | --- | ---: | --- | --- | --- | --- |");
      for (const option of probe.options) {
        const requirement = option.option.requirement;
        lines.push(`| ${[
          option.option.index + 1,
          `\`${option.category}\``,
          formatUsd(option.amountUsd),
          requirement.asset ?? "",
          requirement.network ?? requirement.chain ?? "",
          requirement.payTo ?? "",
          option.blockedReasons[0] ?? option.explanation
        ].map(value => String(value).replace(/\|/g, "\\|")).join(" | ")} |`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function checksFromEvaluation(endpoint: string, options: Safe402EvaluatedProbeOption[]): Safe402ProbeCheck[] {
  if (options.length === 0) {
    return [];
  }

  return options.map(option => ({
    name: `accepts option ${option.option.index + 1} ${endpoint}`,
    status: categoryToCheckStatus(option.category),
    reason: option.explanation,
    fix: option.category === "APPROVED"
      ? undefined
      : option.category === "NEEDS_APPROVAL"
        ? "Ask for human approval before allowing an agent or wallet to pay this option."
        : "Choose another accepts option, change policy, or ask the provider to fix the x402 requirement.",
    details: {
      category: option.category,
      amountUsd: option.amountUsd,
      source: option.option.source,
      blockedReasons: option.blockedReasons,
      privacyFindings: option.privacyFindings.map(finding => finding.type),
      amountAmbiguityFindings: option.amountAmbiguityFindings.map(finding => finding.code)
    }
  }));
}

function categoryToCheckStatus(category: Safe402ProbeDecisionCategory): Safe402ProbeStatus {
  if (category === "APPROVED" || category === "FREE_OR_NOT_GATED") {
    return "pass";
  }

  if (category === "NEEDS_APPROVAL") {
    return "warn";
  }

  return "fail";
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return "$unknown";
  }

  return `$${value >= 1 ? value.toFixed(2) : value.toPrecision(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function legacyDecision(endpoint: string, url: URL, selectedOption: Safe402EvaluatedProbeOption): Safe402Decision {
  return {
    status: selectedOption.policy.status,
    reason: selectedOption.policy.reason,
    url: endpoint,
    domain: url.hostname.toLowerCase(),
    amountUsd: selectedOption.amountUsd,
    requirement: selectedOption.option.requirement,
    duplicateKey: selectedOption.policy.duplicateKey,
    timestamp: new Date().toISOString()
  };
}

function mergeProbeOptions(base: Safe402ProbeOptions, next: Safe402ProbeOptions): Safe402ProbeOptions {
  return {
    ...base,
    ...next,
    endpoints: next.endpoints ?? base.endpoints,
    requestInit: next.requestInit ?? base.requestInit
  };
}
