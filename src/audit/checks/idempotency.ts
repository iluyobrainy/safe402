import type { Safe402PaymentRequirement } from "../../types.js";
import type { Safe402AuditProfile } from "../quote.js";
import { hasPaymentIdentifier } from "./duplicatePayment.js";
import {
  auditCheck,
  stringValue,
  type Safe402AuditCheck
} from "./common.js";

export function auditIdempotency(input: {
  endpoint?: string;
  requirement?: Safe402PaymentRequirement;
  profile?: Safe402AuditProfile;
}): Safe402AuditCheck[] {
  const requirement = input.requirement;

  if (!requirement) {
    return [
      auditCheck({
        name: "idempotency and payment-identifier check",
        severity: "WARN",
        code: "idempotency_unchecked",
        category: "idempotency",
        endpoint: input.endpoint,
        reason: "No payment requirement was available to inspect idempotency support.",
        fix: "Return payment identifiers in the x402 challenge."
      })
    ];
  }

  const idempotencyKey = stringValue(requirement.idempotencyKey) ??
    stringValue(requirement.idempotency_key) ??
    stringValue(requirement.extra?.idempotencyKey) ??
    stringValue(requirement.extra?.idempotency_key);
  const paymentIdentifier = stringValue(requirement.paymentIdentifier) ??
    stringValue(requirement.payment_identifier) ??
    stringValue(requirement.paymentId) ??
    stringValue(requirement.payment_id) ??
    stringValue(requirement.intentId) ??
    stringValue(requirement.intent_id) ??
    stringValue(requirement.extra?.paymentIdentifier) ??
    stringValue(requirement.extra?.payment_identifier);
  const profile = input.profile ?? "basic";
  const missingSeverity = profile === "deep" ? "FAIL" : "WARN";

  return [
    auditCheck({
      name: "payment-identifier support",
      severity: paymentIdentifier ? "PASS" : missingSeverity,
      code: paymentIdentifier ? "payment_identifier_present" : "payment_identifier_missing",
      category: "idempotency",
      endpoint: input.endpoint,
      reason: paymentIdentifier
        ? "Payment requirement includes a payment identifier."
        : "Payment requirement does not include a stable payment identifier.",
      fix: paymentIdentifier ? undefined : "Add payment-identifier support to correlate payment, retry, and receipt.",
      details: { paymentIdentifierPresent: Boolean(paymentIdentifier) }
    }),
    auditCheck({
      name: "idempotency support",
      severity: idempotencyKey ? "PASS" : missingSeverity,
      code: idempotencyKey ? "idempotency_present" : "idempotency_missing",
      category: "idempotency",
      endpoint: input.endpoint,
      reason: idempotencyKey
        ? "Payment requirement includes an idempotency key."
        : "Payment requirement does not include an idempotency key.",
      fix: idempotencyKey ? undefined : "Add idempotency support for retries and duplicate payment prevention.",
      details: { idempotencyKeyPresent: Boolean(idempotencyKey) }
    }),
    auditCheck({
      name: "missing idempotency or payment-identifier support",
      severity: hasPaymentIdentifier(requirement) ? "PASS" : missingSeverity,
      code: hasPaymentIdentifier(requirement) ? "identifier_binding_present" : "identifier_binding_missing",
      category: "idempotency",
      endpoint: input.endpoint,
      reason: hasPaymentIdentifier(requirement)
        ? "At least one identifier is available for retry reconciliation."
        : "No payment identifier or idempotency key is available for retry reconciliation.",
      fix: hasPaymentIdentifier(requirement) ? undefined : "Add payment-identifier and idempotency support."
    })
  ];
}
