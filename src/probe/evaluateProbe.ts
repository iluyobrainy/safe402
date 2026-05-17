import { evaluatePolicy, type Safe402PolicyEvaluation } from "../policy/index.js";
import type { Safe402Policy, Safe402PrivacyFinding, Safe402ReceiptStore } from "../types.js";
import { findSensitiveStrings } from "../utils/redaction.js";
import {
  detectAmountAmbiguity,
  type Safe402AmountAmbiguityFinding
} from "./amountAmbiguity.js";
import {
  chooseBestCompatibleOption,
  type Safe402ProbePaymentOption
} from "./multiAccept.js";

export type Safe402ProbeDecisionCategory =
  | "APPROVED"
  | "NEEDS_APPROVAL"
  | "BLOCKED_BY_POLICY"
  | "SUSPICIOUS"
  | "INVALID_X402"
  | "FREE_OR_NOT_GATED"
  | "UNREACHABLE";

export type Safe402NonX402Status =
  | "free_or_not_gated"
  | "auth_required"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "unavailable"
  | "network_error"
  | "unexpected_status";

export type Safe402EvaluatedProbeOption = {
  option: Safe402ProbePaymentOption;
  category: Safe402ProbeDecisionCategory;
  amountUsd: number;
  policy: Safe402PolicyEvaluation;
  privacyFindings: Safe402PrivacyFinding[];
  amountAmbiguityFindings: Safe402AmountAmbiguityFinding[];
  blockedReasons: string[];
  explanation: string;
};

export type Safe402ProbeEvaluation = {
  category: Safe402ProbeDecisionCategory;
  explanation: string;
  selectedOption?: Safe402EvaluatedProbeOption;
  options: Safe402EvaluatedProbeOption[];
};

export async function evaluateProbe(input: {
  url: URL;
  options: Safe402ProbePaymentOption[];
  policy: Safe402Policy;
  receipts: Safe402ReceiptStore;
}): Promise<Safe402ProbeEvaluation> {
  if (input.options.length === 0) {
    return {
      category: "INVALID_X402",
      explanation: "Endpoint returned HTTP 402, but Safe402 could not find a usable x402 payment requirement.",
      options: []
    };
  }

  const options: Safe402EvaluatedProbeOption[] = [];

  for (const option of input.options) {
    const policy = await evaluatePolicy({
      url: input.url,
      requirement: option.requirement,
      policy: input.policy,
      receipts: input.receipts
    });
    const privacyFindings = findSensitiveStrings(option.requirement, "paymentRequirement");
    const amountAmbiguityFindings = detectAmountAmbiguity({
      requirement: option.requirement,
      parsedAmount: option.parsedAmount,
      policy: input.policy
    });
    const category = categorizeOption({
      parsedValid: option.parsedAmount.valid,
      policy,
      privacyFindings,
      amountAmbiguityFindings,
      blockSensitiveMetadata: input.policy.blockSensitiveMetadata
    });
    const blockedReasons = [
      ...policy.reasons.map(reason => reason.message),
      ...amountAmbiguityFindings.filter(finding => finding.severity === "suspicious").map(finding => finding.message),
      ...(privacyFindings.length > 0 ? [`Sensitive metadata detected: ${privacyFindings.map(finding => finding.type).join(", ")}.`] : [])
    ];

    options.push({
      option,
      category,
      amountUsd: policy.amountUsd,
      policy,
      privacyFindings,
      amountAmbiguityFindings,
      blockedReasons,
      explanation: explainOption({
        category,
        amountUsd: policy.amountUsd,
        policy: input.policy,
        reasons: blockedReasons
      })
    });
  }

  const selectedOption = chooseBestCompatibleOption(options);

  return {
    category: selectedOption?.category ?? "INVALID_X402",
    explanation: selectedOption
      ? explainProbe(selectedOption, input.policy, options)
      : "Safe402 could not select a compatible x402 payment option.",
    selectedOption,
    options
  };
}

export function categorizeNonX402Status(status: number): {
  category: Safe402ProbeDecisionCategory;
  status: Safe402NonX402Status;
  explanation: string;
} {
  if (status >= 200 && status < 300) {
    return {
      category: "FREE_OR_NOT_GATED",
      status: "free_or_not_gated",
      explanation: "Endpoint returned a successful response without an x402 challenge; it appears free or not payment-gated."
    };
  }

  if (status === 401) {
    return {
      category: "INVALID_X402",
      status: "auth_required",
      explanation: "Endpoint returned 401 auth_required instead of a 402 x402 payment challenge."
    };
  }

  if (status === 403) {
    return {
      category: "INVALID_X402",
      status: "forbidden",
      explanation: "Endpoint returned 403 forbidden instead of a 402 x402 payment challenge."
    };
  }

  if (status === 404) {
    return {
      category: "INVALID_X402",
      status: "not_found",
      explanation: "Endpoint returned 404 not_found instead of a 402 x402 payment challenge."
    };
  }

  if (status === 429) {
    return {
      category: "INVALID_X402",
      status: "rate_limited",
      explanation: "Endpoint returned 429 rate_limited instead of a 402 x402 payment challenge."
    };
  }

  if (status === 503) {
    return {
      category: "UNREACHABLE",
      status: "unavailable",
      explanation: "Endpoint returned 503 unavailable, so Safe402 could not inspect an x402 challenge."
    };
  }

  if (status >= 500) {
    return {
      category: "INVALID_X402",
      status: "server_error",
      explanation: `Endpoint returned ${status} server_error instead of a 402 x402 payment challenge.`
    };
  }

  return {
    category: "INVALID_X402",
    status: "unexpected_status",
    explanation: `Endpoint returned ${status} instead of a 402 x402 payment challenge.`
  };
}

export function categorizeNetworkError(error: unknown): {
  category: "UNREACHABLE";
  status: "network_error";
  explanation: string;
} {
  const reason = error instanceof Error ? error.message : "network error";

  return {
    category: "UNREACHABLE",
    status: "network_error",
    explanation: `Endpoint was unreachable during unpaid probe: ${reason}.`
  };
}

function categorizeOption(input: {
  parsedValid: boolean;
  policy: Safe402PolicyEvaluation;
  privacyFindings: Safe402PrivacyFinding[];
  amountAmbiguityFindings: Safe402AmountAmbiguityFinding[];
  blockSensitiveMetadata?: boolean;
}): Safe402ProbeDecisionCategory {
  if (!input.parsedValid) {
    return "INVALID_X402";
  }

  if (!input.policy.allowed) {
    return "BLOCKED_BY_POLICY";
  }

  if (input.amountAmbiguityFindings.some(finding => finding.severity === "suspicious")) {
    return "SUSPICIOUS";
  }

  if (input.privacyFindings.length > 0 && !input.blockSensitiveMetadata) {
    return "SUSPICIOUS";
  }

  if (input.policy.status === "approval_required") {
    return "NEEDS_APPROVAL";
  }

  return "APPROVED";
}

function explainProbe(
  selected: Safe402EvaluatedProbeOption,
  policy: Safe402Policy,
  options: Safe402EvaluatedProbeOption[]
): string {
  if (selected.category === "APPROVED" && options.some(option => option.category !== "APPROVED")) {
    return `${explainOption({ category: selected.category, amountUsd: selected.amountUsd, policy, reasons: selected.blockedReasons })} Safe402 selected the best compatible option from ${options.length} accepts entries.`;
  }

  if (selected.category === "BLOCKED_BY_POLICY" && options.every(option => option.category === "BLOCKED_BY_POLICY")) {
    return `${explainOption({ category: selected.category, amountUsd: selected.amountUsd, policy, reasons: selected.blockedReasons })} No accepts option matched the current policy.`;
  }

  return explainOption({
    category: selected.category,
    amountUsd: selected.amountUsd,
    policy,
    reasons: selected.blockedReasons
  });
}

function explainOption(input: {
  category: Safe402ProbeDecisionCategory;
  amountUsd: number;
  policy: Safe402Policy;
  reasons: string[];
}): string {
  const requested = `Endpoint requested $${formatAmount(input.amountUsd)}.`;

  if (input.category === "APPROVED") {
    return `${requested} It is within your Safe402 policy.`;
  }

  if (input.category === "NEEDS_APPROVAL") {
    return `${requested} Your approval threshold is $${formatAmount(input.policy.requireApprovalAboveUsd ?? 0)}. Human approval is required before paying.`;
  }

  if (input.category === "BLOCKED_BY_POLICY") {
    if (input.policy.maxPaymentUsd !== undefined && input.amountUsd > input.policy.maxPaymentUsd) {
      return `Blocked by policy. Endpoint requested $${formatAmount(input.amountUsd)}, but your max auto-spend is $${formatAmount(input.policy.maxPaymentUsd)}. This does not mean the provider is malicious.`;
    }

    const reason = input.reasons[0] ? ` ${input.reasons[0]}` : "";
    return `Blocked by policy. Endpoint requested $${formatAmount(input.amountUsd)}, but your Safe402 policy does not allow this payment. This does not mean the provider is malicious.${reason}`;
  }

  if (input.category === "SUSPICIOUS") {
    const reason = input.reasons[0] ? ` ${input.reasons[0]}` : "";
    return `${requested} Safe402 found suspicious payment metadata or amount ambiguity.${reason}`;
  }

  return input.reasons[0] ?? `${requested} Safe402 could not validate this x402 payment option.`;
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return "unknown";
  }

  return value >= 1 ? value.toFixed(2) : value.toPrecision(6).replace(/0+$/, "").replace(/\.$/, "");
}
