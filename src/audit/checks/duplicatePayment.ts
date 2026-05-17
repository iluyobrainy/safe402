import { createMemoryReceiptStore } from "../../billing/index.js";
import { evaluatePayment } from "../../policy/index.js";
import type { Safe402PaymentRequirement, Safe402Policy } from "../../types.js";
import {
  auditCheck,
  stringValue,
  type Safe402AuditCheck
} from "./common.js";

export async function auditDuplicatePayment(input: {
  endpoint: string;
  requirement: Safe402PaymentRequirement;
  policy?: Safe402Policy;
}): Promise<Safe402AuditCheck[]> {
  const receipts = createMemoryReceiptStore();
  const policy = {
    maxPaymentUsd: 1,
    duplicateWindowMs: 30 * 60 * 1000,
    ...(input.policy ?? {})
  };
  const url = new URL(input.endpoint);
  const firstDecision = await evaluatePayment({
    url,
    requirement: input.requirement,
    policy,
    receipts
  });

  await receipts.save({
    ...firstDecision,
    status: "paid",
    reason: "seeded audit duplicate receipt"
  });

  const secondDecision = await evaluatePayment({
    url,
    requirement: input.requirement,
    policy,
    receipts
  });
  const hasIdentifier = hasPaymentIdentifier(input.requirement);

  return [
    auditCheck({
      name: "duplicate retry risk",
      severity: secondDecision.status === "denied" ? "PASS" : "CRITICAL",
      code: secondDecision.status === "denied" ? "duplicate_retry_blocked" : "duplicate_retry_payable",
      category: "duplicate",
      endpoint: input.endpoint,
      reason: secondDecision.status === "denied"
        ? "A repeated payment attempt for the same intent was blocked by duplicate detection."
        : "A repeated payment attempt for the same intent was still payable.",
      fix: secondDecision.status === "denied" ? undefined : "Add duplicate-payment detection keyed by resource, amount, network, asset, and payTo.",
      details: {
        firstDecision: firstDecision.status,
        secondDecision: secondDecision.status,
        duplicateKey: secondDecision.duplicateKey
      }
    }),
    auditCheck({
      name: "payment identifier duplicate binding",
      severity: hasIdentifier ? "PASS" : "WARN",
      code: hasIdentifier ? "payment_identifier_present" : "payment_identifier_missing",
      category: "duplicate",
      endpoint: input.endpoint,
      reason: hasIdentifier
        ? "The requirement includes a payment identifier or idempotency key that can bind duplicate retries."
        : "The requirement does not expose a payment identifier or idempotency key for duplicate retry reconciliation.",
      fix: hasIdentifier ? undefined : "Add payment-identifier and idempotency support to payment requirements.",
      details: {
        hasIdentifier
      }
    })
  ];
}

export function hasPaymentIdentifier(requirement: Safe402PaymentRequirement): boolean {
  return Boolean(
    stringValue(requirement.paymentIdentifier) ||
    stringValue(requirement.payment_identifier) ||
    stringValue(requirement.paymentId) ||
    stringValue(requirement.payment_id) ||
    stringValue(requirement.intentId) ||
    stringValue(requirement.intent_id) ||
    stringValue(requirement.idempotencyKey) ||
    stringValue(requirement.idempotency_key) ||
    stringValue(requirement.extra?.paymentIdentifier) ||
    stringValue(requirement.extra?.idempotencyKey)
  );
}
