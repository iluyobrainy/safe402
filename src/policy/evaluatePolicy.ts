import {
  DEFAULT_DUPLICATE_WINDOW_MS,
  getSpentTodayUsd
} from "../billing/index.js";
import { parseRequirementAmount } from "../probe/parseRequirementAmount.js";
import type {
  Safe402Decision,
  Safe402DecisionStatus,
  Safe402PaymentRequirement,
  Safe402Policy,
  Safe402ReceiptStore
} from "../types.js";
import {
  createDuplicateKey,
  findSensitivePaymentMetadata,
  includesNormalized
} from "../utils/index.js";
import { loadPolicy } from "./loadPolicy.js";

export type Safe402PolicyBlockReason = {
  code: string;
  message: string;
};

export type Safe402PolicyEvaluation = {
  allowed: boolean;
  status: Safe402DecisionStatus;
  reason: string;
  reasons: Safe402PolicyBlockReason[];
  amountUsd: number;
  duplicateKey: string;
};

export async function evaluatePolicy(input: {
  url: URL;
  requirement: Safe402PaymentRequirement;
  policy: Safe402Policy;
  receipts: Safe402ReceiptStore;
}): Promise<Safe402PolicyEvaluation> {
  const policy = loadPolicy(input.policy);
  const parsedAmount = parseRequirementAmount(input.requirement, policy);
  const amountUsd = parsedAmount.amountUsd;
  const domain = input.url.hostname.toLowerCase();
  const duplicateKey = createDuplicateKey(input.url, input.requirement);
  const reasons: Safe402PolicyBlockReason[] = [];
  const network = stringValue(input.requirement.network ?? input.requirement.chain);
  const asset = stringValue(input.requirement.asset);
  const payee = stringValue(input.requirement.payTo);
  const expiresAt = parseExpiry(input.requirement.expiresAt ?? input.requirement.expires_at ?? input.requirement.expiration);
  const ttlSeconds = numberValue(input.requirement.ttlSeconds ?? input.requirement.ttl);

  if (!parsedAmount.valid) {
    reasons.push({ code: "invalid_amount", message: parsedAmount.reason });
  }

  if (parsedAmount.valid && amountUsd <= 0) {
    reasons.push({ code: "non_positive_amount", message: "Payment amount must be greater than zero." });
  }

  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    reasons.push({ code: "expired_challenge", message: "Payment challenge is expired." });
  }

  if (ttlSeconds !== undefined && ttlSeconds <= 0) {
    reasons.push({ code: "expired_challenge", message: "Payment challenge TTL is expired." });
  }

  if (includesNormalized(policy.blockedDomains, domain)) {
    reasons.push({ code: "blocked_domain", message: `Domain ${domain} is blocked.` });
  }

  const privacyFindings = findSensitivePaymentMetadata(input.requirement);
  if (policy.blockSensitiveMetadata && privacyFindings.length > 0) {
    reasons.push({
      code: "sensitive_metadata",
      message: `Sensitive metadata detected: ${privacyFindings.map(finding => finding.type).join(", ")}.`
    });
  }

  if (policy.allowedDomains?.length && !includesNormalized(policy.allowedDomains, domain)) {
    reasons.push({ code: "domain_not_allowed", message: `Domain ${domain} is not in the allowed domain list.` });
  }

  if (policy.allowedNetworks?.length && network && !includesNormalized(policy.allowedNetworks, network)) {
    reasons.push({ code: "network_not_allowed", message: `Network ${network} is not allowed.` });
  }

  if (policy.allowedAssets?.length && asset && !includesNormalized(policy.allowedAssets, asset)) {
    reasons.push({ code: "asset_not_allowed", message: `Asset ${asset} is not allowed.` });
  }

  const blockedPayees = [
    ...(policy.blockedPayees ?? []),
    ...(policy.blockedPayTo ?? [])
  ];
  const allowedPayees = [
    ...(policy.allowedPayees ?? []),
    ...(policy.allowedPayTo ?? [])
  ];

  if (blockedPayees.length && payee && includesNormalized(blockedPayees, payee)) {
    reasons.push({ code: "blocked_payee", message: `Payee ${payee} is blocked.` });
  }

  if (allowedPayees.length && payee && !includesNormalized(allowedPayees, payee)) {
    reasons.push({ code: "payee_not_allowed", message: `Payee ${payee} is not allowed.` });
  }

  if (policy.maxPaymentUsd !== undefined && amountUsd > policy.maxPaymentUsd) {
    reasons.push({ code: "max_payment_exceeded", message: `Payment ${amountUsd} exceeds per-call limit ${policy.maxPaymentUsd}.` });
  }

  const existingReceipts = await input.receipts.list();
  const spentToday = getSpentTodayUsd(existingReceipts);

  if (policy.dailyBudgetUsd !== undefined && spentToday + amountUsd > policy.dailyBudgetUsd) {
    reasons.push({ code: "daily_budget_exceeded", message: `Payment would exceed daily budget ${policy.dailyBudgetUsd}.` });
  }

  const duplicateWindowMs = policy.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS;
  const duplicateSince = Date.now() - duplicateWindowMs;
  const duplicate = existingReceipts.some(receipt => (
    receipt.status === "paid" &&
    receipt.duplicateKey === duplicateKey &&
    new Date(receipt.timestamp).getTime() >= duplicateSince
  ));

  if (duplicate) {
    reasons.push({ code: "duplicate_payment", message: "Duplicate payment attempt blocked." });
  }

  if (reasons.length > 0) {
    return {
      allowed: false,
      status: "denied",
      reason: reasons[0].message,
      reasons,
      amountUsd,
      duplicateKey
    };
  }

  if (policy.requireApprovalAboveUsd !== undefined && amountUsd > policy.requireApprovalAboveUsd) {
    return {
      allowed: true,
      status: "approval_required",
      reason: "Payment requires human approval.",
      reasons: [],
      amountUsd,
      duplicateKey
    };
  }

  return {
    allowed: true,
    status: "approved",
    reason: "Payment passed Safe402 policy.",
    reasons: [],
    amountUsd,
    duplicateKey
  };
}

export async function evaluatePayment(input: {
  url: URL;
  requirement: Safe402PaymentRequirement;
  policy: Safe402Policy;
  receipts: Safe402ReceiptStore;
  paymentIntent?: string;
}): Promise<Safe402Decision> {
  const evaluation = await evaluatePolicy(input);

  return {
    status: evaluation.status,
    reason: evaluation.reason,
    url: input.url.href,
    domain: input.url.hostname.toLowerCase(),
    amountUsd: evaluation.amountUsd,
    requirement: input.requirement,
    paymentIntent: input.paymentIntent,
    duplicateKey: evaluation.duplicateKey,
    timestamp: new Date().toISOString()
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parseExpiry(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
