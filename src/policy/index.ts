import {
  DEFAULT_DUPLICATE_WINDOW_MS,
  DEFAULT_PAID_DENIAL_STATUS_CODES,
  getSpentTodayUsd
} from "../billing/index.js";
import type {
  Safe402Decision,
  Safe402PaymentRequirement,
  Safe402Policy,
  Safe402ReceiptStore
} from "../types.js";
import {
  createDuplicateKey,
  findSensitivePaymentMetadata,
  includesNormalized,
  parseRequirementAmount
} from "../utils/index.js";

export const defaultPolicy: Safe402Policy = {
  blockPaymentIntentChanges: true,
  duplicateWindowMs: DEFAULT_DUPLICATE_WINDOW_MS,
  failOnPaidStatusCodes: DEFAULT_PAID_DENIAL_STATUS_CODES
};

export function loadPolicy(policy: Safe402Policy = {}): Safe402Policy {
  return {
    ...defaultPolicy,
    ...policy,
    duplicateWindowMs: policy.duplicateWindowMs ?? defaultPolicy.duplicateWindowMs,
    failOnPaidStatusCodes: policy.failOnPaidStatusCodes ?? defaultPolicy.failOnPaidStatusCodes
  };
}

export async function evaluatePayment(input: {
  url: URL;
  requirement: Safe402PaymentRequirement;
  policy: Safe402Policy;
  receipts: Safe402ReceiptStore;
  paymentIntent?: string;
}): Promise<Safe402Decision> {
  const { url, requirement, receipts, paymentIntent } = input;
  const policy = loadPolicy(input.policy);
  const parsedAmount = parseRequirementAmount(requirement, policy);
  const amountUsd = parsedAmount.amountUsd;
  const domain = url.hostname.toLowerCase();
  const timestamp = new Date().toISOString();
  const duplicateKey = createDuplicateKey(url, requirement);

  const baseDecision: Omit<Safe402Decision, "status" | "reason"> = {
    url: url.href,
    domain,
    amountUsd,
    requirement,
    paymentIntent,
    duplicateKey,
    timestamp
  };

  if (!parsedAmount.valid) {
    return { ...baseDecision, status: "denied", reason: parsedAmount.reason };
  }

  if (amountUsd <= 0) {
    return { ...baseDecision, status: "denied", reason: "Payment amount must be greater than zero." };
  }

  if (includesNormalized(policy.blockedDomains, domain)) {
    return { ...baseDecision, status: "denied", reason: `Domain ${domain} is blocked.` };
  }

  const privacyFindings = findSensitivePaymentMetadata(requirement);
  if (policy.blockSensitiveMetadata && privacyFindings.length > 0) {
    return { ...baseDecision, status: "denied", reason: `Sensitive metadata detected: ${privacyFindings.map(finding => finding.type).join(", ")}.` };
  }

  if (policy.allowedDomains?.length && !includesNormalized(policy.allowedDomains, domain)) {
    return { ...baseDecision, status: "denied", reason: `Domain ${domain} is not in the allowed domain list.` };
  }

  if (policy.allowedNetworks?.length && requirement.network && !includesNormalized(policy.allowedNetworks, requirement.network)) {
    return { ...baseDecision, status: "denied", reason: `Network ${requirement.network} is not allowed.` };
  }

  if (policy.allowedAssets?.length && requirement.asset && !includesNormalized(policy.allowedAssets, requirement.asset)) {
    return { ...baseDecision, status: "denied", reason: `Asset ${requirement.asset} is not allowed.` };
  }

  if (policy.allowedPayTo?.length && requirement.payTo && !includesNormalized(policy.allowedPayTo, requirement.payTo)) {
    return { ...baseDecision, status: "denied", reason: `Payee ${requirement.payTo} is not allowed.` };
  }

  if (policy.maxPaymentUsd !== undefined && amountUsd > policy.maxPaymentUsd) {
    return { ...baseDecision, status: "denied", reason: `Payment ${amountUsd} exceeds per-call limit ${policy.maxPaymentUsd}.` };
  }

  const existingReceipts = await receipts.list();
  const spentToday = getSpentTodayUsd(existingReceipts);

  if (policy.dailyBudgetUsd !== undefined && spentToday + amountUsd > policy.dailyBudgetUsd) {
    return { ...baseDecision, status: "denied", reason: `Payment would exceed daily budget ${policy.dailyBudgetUsd}.` };
  }

  const duplicateWindowMs = policy.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS;
  const duplicateSince = Date.now() - duplicateWindowMs;
  const duplicate = existingReceipts.some(receipt => (
    receipt.status === "paid" &&
    receipt.duplicateKey === duplicateKey &&
    new Date(receipt.timestamp).getTime() >= duplicateSince
  ));

  if (duplicate) {
    return { ...baseDecision, status: "denied", reason: "Duplicate payment attempt blocked." };
  }

  if (policy.requireApprovalAboveUsd !== undefined && amountUsd > policy.requireApprovalAboveUsd) {
    return { ...baseDecision, status: "approval_required", reason: "Payment requires human approval." };
  }

  return { ...baseDecision, status: "approved", reason: "Payment passed Safe402 policy." };
}
