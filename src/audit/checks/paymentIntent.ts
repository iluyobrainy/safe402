import type { Safe402PaymentRequirement } from "../../types.js";
import {
  createPaymentIntentFingerprint,
  getRequestMethod,
  normalizeUrl,
  stableHash,
  summarizeRequestBody,
  toUrl
} from "../../utils/index.js";
import {
  auditCheck,
  scalarString,
  stringValue,
  type Safe402AuditCheck
} from "./common.js";

export function auditPaymentIntent(input: {
  endpoint: string;
  requirement?: Safe402PaymentRequirement;
  requestInit?: RequestInit;
}): Safe402AuditCheck[] {
  const requirement = input.requirement;
  const method = getRequestMethod(input.endpoint, input.requestInit);
  const url = normalizeUrl(toUrl(input.endpoint));
  const bodySummary = summarizeRequestBody(input.endpoint, input.requestInit);
  const parts = {
    method,
    url,
    bodyHash: stableHash(bodySummary),
    amount: requirement ? scalarString(requirement.maxAmountRequired ?? requirement.amount ?? requirement.amountUsd) : undefined,
    network: requirement ? stringValue(requirement.network ?? requirement.chain) : undefined,
    asset: requirement ? stringValue(requirement.asset) : undefined,
    payTo: requirement ? stringValue(requirement.payTo ?? requirement.payee ?? requirement.recipient ?? requirement.to) : undefined,
    agentTaskId: requirement ? stringValue(requirement.agentTaskId ?? requirement.taskId ?? requirement.extra?.agentTaskId) : undefined
  };
  const missing = Object.entries(parts)
    .filter(([key, value]) => key !== "agentTaskId" && !value)
    .map(([key]) => key);
  const fingerprint = createPaymentIntentFingerprint({
    input: input.endpoint,
    init: input.requestInit,
    requirement
  });

  return [
    auditCheck({
      name: "payment intent fingerprint stability",
      severity: missing.length > 0 ? "FAIL" : "PASS",
      code: missing.length > 0 ? "payment_intent_incomplete" : "payment_intent_fingerprint",
      category: "payment_intent",
      endpoint: input.endpoint,
      reason: missing.length > 0
        ? `Payment intent fingerprint is missing required part${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`
        : "Payment intent fingerprint covers method, URL, body hash, amount, network, asset, and payTo.",
      fix: missing.length > 0
        ? "Include method, url, body hash, amount, network, asset, payTo, and agentTaskId when available in payment intent checks."
        : undefined,
      details: {
        fingerprint,
        parts,
        missing
      }
    }),
    auditCheck({
      name: "agentTaskId intent binding",
      severity: parts.agentTaskId ? "PASS" : "INFO",
      code: parts.agentTaskId ? "agent_task_id_bound" : "agent_task_id_not_present",
      category: "payment_intent",
      endpoint: input.endpoint,
      reason: parts.agentTaskId
        ? "agentTaskId is available for binding payment intent to an agent task."
        : "agentTaskId was not present; this is optional but useful for deeper agent payment attribution.",
      fix: parts.agentTaskId ? undefined : "Include agentTaskId for agent-initiated paid actions when available.",
      details: {
        agentTaskId: parts.agentTaskId
      }
    })
  ];
}

export function auditPaymentIntentMutationSelfTest(): Safe402AuditCheck {
  const requirement: Safe402PaymentRequirement = {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    payTo: "0x0000000000000000000000000000000000000000",
    maxAmountRequired: "10000",
    resource: "https://api.safe402.test/paid"
  };
  const first = createPaymentIntentFingerprint({
    input: "https://api.safe402.test/paid",
    init: { method: "POST", body: "task=a" },
    requirement
  });
  const second = createPaymentIntentFingerprint({
    input: "https://api.safe402.test/paid",
    init: { method: "POST", body: "task=b" },
    requirement
  });

  return auditCheck({
    name: "method and body mutation risk",
    severity: first !== second ? "PASS" : "CRITICAL",
    code: first !== second ? "body_mutation_changes_intent" : "body_mutation_not_fingerprinted",
    category: "payment_intent",
    reason: first !== second
      ? "Changing the request body changes the payment intent fingerprint."
      : "Changing the request body did not change the payment intent fingerprint.",
    fix: first !== second
      ? undefined
      : "Fingerprint method, URL, body hash, amount, network, asset, payTo, and agentTaskId before retrying paid requests.",
    details: {
      first,
      second
    }
  });
}
