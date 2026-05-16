import { createMemoryReceiptStore } from "../billing/index.js";
import { evaluatePayment, loadPolicy } from "../policy/index.js";
import {
  formatCheckReport,
  summarizeChecks,
  worstStatus,
  type Safe402CheckStatus,
  type Safe402ReportCheck,
  type Safe402ReportSummary
} from "../reports/index.js";
import type {
  Safe402Decision,
  Safe402PaymentRequirement,
  Safe402Policy,
  Safe402ReceiptStore
} from "../types.js";
import {
  extractPaymentRequirement,
  findSensitivePaymentMetadata
} from "../utils/index.js";

// Product boundary: a probe is an unpaid inspection of one or more x402
// challenges. It answers "what would this endpoint ask my agent to pay, and
// does that match policy?" It does not simulate paid retries, receipt failures,
// or adversarial runtime behavior; those belong to audit.

export type Safe402ProbeCheck = Safe402ReportCheck;
export type Safe402ProbeStatus = Safe402CheckStatus;

export type Safe402ProbeOptions = {
  policy?: Safe402Policy;
  endpoints?: string[];
  fetch?: typeof fetch;
  receipts?: Safe402ReceiptStore;
};

export type Safe402ProbeResult = {
  url: string;
  status: Safe402ProbeStatus;
  responseStatus?: number;
  requirement?: Safe402PaymentRequirement;
  decision?: Safe402Decision;
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
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const policy = loadPolicy(options.policy);
  const checks: Safe402ProbeCheck[] = [];

  try {
    const response = await fetchImpl(endpoint);

    if (response.status !== 402) {
      checks.push({
        name: `endpoint preflight ${endpoint}`,
        status: "warn",
        reason: `Expected 402 Payment Required, got ${response.status}.`,
        fix: "Point the probe at an x402-protected resource that returns a 402 challenge before payment."
      });

      return {
        url: endpoint,
        status: worstStatus(checks),
        responseStatus: response.status,
        checks
      };
    }

    const requirement = await extractPaymentRequirement(response);
    const receipts = options.receipts ?? createMemoryReceiptStore();
    const decision = await evaluatePayment({
      url: new URL(endpoint),
      requirement,
      policy,
      receipts
    });

    checks.push({
      name: `endpoint policy check ${endpoint}`,
      status: probeDecisionStatus(decision),
      reason: decision.reason,
      fix: decision.status === "approved"
        ? undefined
        : "Adjust Safe402 policy or the x402 payment requirement before allowing an agent to pay this endpoint.",
      details: {
        decision: decision.status,
        amountUsd: decision.amountUsd,
        domain: decision.domain
      }
    });

    const privacyFindings = findSensitivePaymentMetadata(requirement);
    checks.push({
      name: `endpoint metadata privacy ${endpoint}`,
      status: privacyFindings.length === 0 ? "pass" : "warn",
      reason: privacyFindings.length === 0
        ? "No obvious sensitive metadata found in payment requirement."
        : `Sensitive metadata may be present: ${privacyFindings.map(finding => finding.type).join(", ")}.`,
      fix: privacyFindings.length === 0
        ? undefined
        : "Remove private user/task data from resource URLs, descriptions, and reason strings before returning the payment requirement."
    });

    return {
      url: endpoint,
      status: worstStatus(checks),
      responseStatus: response.status,
      requirement,
      decision,
      checks
    };
  } catch (error) {
    checks.push({
      name: `endpoint preflight ${endpoint}`,
      status: "fail",
      reason: error instanceof Error ? error.message : "Endpoint probe failed.",
      fix: "Check the endpoint URL, local server, network, and whether the endpoint returns a valid x402 challenge."
    });

    return {
      url: endpoint,
      status: "fail",
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
      "unpaid 402 challenge fetch",
      "payment requirement extraction",
      "policy evaluation",
      "metadata privacy scan"
    ],
    note: "A Safe402 probe does not sign, settle, or retry a paid request."
  };
}

export function formatProbeReport(report: Safe402ProbeReport): string {
  return formatCheckReport("Safe402 probe", report.checks);
}

function probeDecisionStatus(decision: Safe402Decision): Safe402ProbeStatus {
  if (decision.status === "approved") {
    return "pass";
  }

  if (decision.status === "approval_required") {
    return "warn";
  }

  return "fail";
}

function mergeProbeOptions(base: Safe402ProbeOptions, next: Safe402ProbeOptions): Safe402ProbeOptions {
  return {
    ...base,
    ...next,
    endpoints: next.endpoints ?? base.endpoints
  };
}
