import { DEFAULT_PAID_DENIAL_STATUS_CODES } from "../../billing/index.js";
import { createSafe402Fetch, Safe402Error } from "../../runtime.js";
import type { Safe402PaymentRequirement, Safe402Policy } from "../../types.js";
import {
  auditCheck,
  type Safe402AuditCheck
} from "./common.js";

const SAFE_REQUIREMENT: Safe402PaymentRequirement = {
  scheme: "exact",
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x0000000000000000000000000000000000000000",
  maxAmountRequired: "10000",
  resource: "https://api.safe402.test/paid",
  paymentIdentifier: "audit-payment-001",
  idempotencyKey: "audit-idempotency-001",
  facilitator: "https://facilitator.safe402.test"
};

const SAFE_POLICY: Safe402Policy = {
  maxPaymentUsd: 0.1,
  allowedDomains: ["api.safe402.test"],
  allowedNetworks: ["base-sepolia"],
  allowedAssets: ["USDC"],
  requirePaymentResponseHeader: true,
  blockPaymentIntentChanges: true,
  failOnPaidStatusCodes: DEFAULT_PAID_DENIAL_STATUS_CODES
};

export async function auditRetryLoopProtections(): Promise<Safe402AuditCheck[]> {
  const checks: Safe402AuditCheck[] = [];

  checks.push(await catchesRepeated402());
  checks.push(await avoidsPermanentErrorRetry());
  checks.push(await avoidsChainMismatchRetry());
  checks.push(await avoidsExpiredChallengeRetry());
  checks.push(await stopsOnFacilitatorDowntime());
  checks.push(await blocksMissingPaymentResponse());
  checks.push(await acceptsXPaymentResponse());
  checks.push(await blocksPaidButDenied());

  return checks;
}

export function auditUnpaidServiceRisk(input: {
  endpoint: string;
  responseStatus?: number;
}): Safe402AuditCheck {
  if (input.responseStatus !== undefined && input.responseStatus >= 200 && input.responseStatus < 300) {
    return auditCheck({
      name: "unpaid-service risk",
      severity: "FAIL",
      code: "unpaid_service_possible",
      category: "delivery",
      endpoint: input.endpoint,
      reason: "Endpoint returned a successful response during unpaid audit preflight.",
      fix: "Require settlement validation before returning paid service results."
    });
  }

  return auditCheck({
    name: "unpaid-service risk",
    severity: "PASS",
    code: "unpaid_service_not_observed",
    category: "delivery",
    endpoint: input.endpoint,
    reason: "The endpoint did not appear to provide paid service without an x402 challenge."
  });
}

export function auditPaidButDeniedStatic(input: {
  endpoint: string;
  requirement?: Safe402PaymentRequirement;
}): Safe402AuditCheck {
  const resource = typeof input.requirement?.resource === "string" ? input.requirement.resource : undefined;

  if (!resource) {
    return auditCheck({
      name: "paid-but-denied risk",
      severity: "WARN",
      code: "service_delivery_unverifiable",
      category: "delivery",
      endpoint: input.endpoint,
      reason: "The challenge does not bind payment to a stable resource, so service delivery after payment cannot be verified.",
      fix: "Bind the paid response to a stable resource and attach receipt proof to the audit report."
    });
  }

  return auditCheck({
    name: "paid-but-denied risk",
    severity: "INFO",
    code: "service_delivery_not_verified",
    category: "delivery",
    endpoint: input.endpoint,
    reason: "Safe402 found a stable resource binding, but live service delivery still requires sandbox or paid-flow verification.",
    fix: "Use sandbox payment verification for high-value integrations.",
    details: { resource }
  });
}

async function catchesRepeated402(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge(SAFE_REQUIREMENT),
    paidFetch: async () => new Response(JSON.stringify({ error: "still requires payment" }), { status: 402 }),
    policy: SAFE_POLICY
  });

  try {
    await safeFetch("https://api.safe402.test/paid");
  } catch (error) {
    return expectSafe402Failure({
      error,
      name: "retry loop risk: repeated 402s",
      passCode: "repeated_402_retry_fused",
      failCode: "repeated_402_retry_loop",
      passReason: "Paid fetch returned another 402 and Safe402 stopped instead of retrying payment.",
      fix: "Add a retry fuse for repeated 402 responses after payment."
    });
  }

  return auditCheck({
    name: "retry loop risk: repeated 402s",
    severity: "CRITICAL",
    code: "repeated_402_retry_loop",
    category: "retry",
    reason: "Safe402 did not stop a paid response that returned another 402.",
    fix: "Add a retry fuse for repeated 402 responses after payment."
  });
}

async function avoidsPermanentErrorRetry(): Promise<Safe402AuditCheck> {
  let paidFetchCalls = 0;
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge(SAFE_REQUIREMENT),
    paidFetch: async () => {
      paidFetchCalls += 1;
      return new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        headers: { "PAYMENT-RESPONSE": "demo" }
      });
    },
    policy: SAFE_POLICY
  });

  await safeFetch("https://api.safe402.test/paid").catch(() => undefined);

  return auditCheck({
    name: "retry loop risk: permanent error retried",
    severity: paidFetchCalls === 1 ? "PASS" : "CRITICAL",
    code: paidFetchCalls === 1 ? "permanent_error_not_retried" : "permanent_error_retry_loop",
    category: "retry",
    reason: paidFetchCalls === 1
      ? "A permanent paid-response error did not trigger repeated paid retries."
      : `A permanent paid-response error triggered ${paidFetchCalls} paid retries.`,
    fix: paidFetchCalls === 1 ? undefined : "Add a retry fuse for permanent paid-response errors.",
    details: { paidFetchCalls }
  });
}

async function avoidsChainMismatchRetry(): Promise<Safe402AuditCheck> {
  let paidFetchCalls = 0;
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge({ ...SAFE_REQUIREMENT, network: "base" }),
    paidFetch: async () => {
      paidFetchCalls += 1;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "PAYMENT-RESPONSE": "demo" }
      });
    },
    policy: SAFE_POLICY
  });

  await safeFetch("https://api.safe402.test/paid").catch(() => undefined);

  return auditCheck({
    name: "retry loop risk: chain mismatch retried",
    severity: paidFetchCalls === 0 ? "PASS" : "CRITICAL",
    code: paidFetchCalls === 0 ? "chain_mismatch_not_paid" : "chain_mismatch_paid_retry",
    category: "retry",
    reason: paidFetchCalls === 0
      ? "Unsupported chain was denied before any paid retry."
      : "Unsupported chain still reached paid retry.",
    fix: paidFetchCalls === 0 ? undefined : "Block unsupported chains before payment retry.",
    details: { paidFetchCalls }
  });
}

async function avoidsExpiredChallengeRetry(): Promise<Safe402AuditCheck> {
  let paidFetchCalls = 0;
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge({
      ...SAFE_REQUIREMENT,
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    }),
    paidFetch: async () => {
      paidFetchCalls += 1;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "PAYMENT-RESPONSE": "demo" }
      });
    },
    policy: SAFE_POLICY
  });

  await safeFetch("https://api.safe402.test/paid").catch(() => undefined);

  return auditCheck({
    name: "retry loop risk: expired challenge retried",
    severity: paidFetchCalls === 0 ? "PASS" : "CRITICAL",
    code: paidFetchCalls === 0 ? "expired_challenge_not_paid" : "expired_challenge_paid_retry",
    category: "retry",
    reason: paidFetchCalls === 0
      ? "Expired challenge was denied before paid retry."
      : "Expired challenge still reached paid retry.",
    fix: paidFetchCalls === 0 ? undefined : "Reject expired challenges before payment.",
    details: { paidFetchCalls }
  });
}

async function stopsOnFacilitatorDowntime(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge(SAFE_REQUIREMENT),
    paidFetch: async () => {
      throw new Error("facilitator unavailable");
    },
    policy: SAFE_POLICY
  });

  try {
    await safeFetch("https://api.safe402.test/paid");
  } catch (error) {
    return expectSafe402Failure({
      error,
      name: "retry loop risk: facilitator downtime retried",
      passCode: "facilitator_downtime_failed_closed",
      failCode: "facilitator_downtime_retry_loop",
      passReason: "Facilitator downtime failed closed without repeated paid retries.",
      fix: "Fail closed on facilitator downtime and require explicit retry approval."
    });
  }

  return auditCheck({
    name: "retry loop risk: facilitator downtime retried",
    severity: "CRITICAL",
    code: "facilitator_downtime_not_failed_closed",
    category: "retry",
    reason: "Facilitator downtime did not fail closed.",
    fix: "Fail closed on facilitator downtime and require explicit retry approval."
  });
}

async function blocksMissingPaymentResponse(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge(SAFE_REQUIREMENT),
    paidFetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    policy: SAFE_POLICY
  });

  try {
    await safeFetch("https://api.safe402.test/paid");
  } catch (error) {
    return expectSafe402Failure({
      error,
      name: "missing PAYMENT-RESPONSE after paid path",
      passCode: "missing_payment_response_blocked",
      failCode: "missing_payment_response_allowed",
      passReason: "Paid response without PAYMENT-RESPONSE was blocked.",
      fix: "Require PAYMENT-RESPONSE or X-PAYMENT-RESPONSE before treating the request as paid."
    });
  }

  return auditCheck({
    name: "missing PAYMENT-RESPONSE after paid path",
    severity: "CRITICAL",
    code: "missing_payment_response_allowed",
    category: "retry",
    reason: "Paid response without PAYMENT-RESPONSE was allowed.",
    fix: "Require PAYMENT-RESPONSE or X-PAYMENT-RESPONSE before treating the request as paid."
  });
}

async function acceptsXPaymentResponse(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge(SAFE_REQUIREMENT),
    paidFetch: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "X-PAYMENT-RESPONSE": "demo" }
    }),
    policy: SAFE_POLICY
  });

  try {
    const response = await safeFetch("https://api.safe402.test/paid");

    return auditCheck({
      name: "missing X-PAYMENT-RESPONSE if applicable",
      severity: response.status === 200 ? "PASS" : "FAIL",
      code: response.status === 200 ? "x_payment_response_accepted" : "x_payment_response_rejected",
      category: "retry",
      reason: response.status === 200
        ? "X-PAYMENT-RESPONSE is accepted as receipt proof when present."
        : `X-PAYMENT-RESPONSE path returned status ${response.status}.`,
      fix: response.status === 200 ? undefined : "Accept X-PAYMENT-RESPONSE where applicable, or document that only PAYMENT-RESPONSE is supported."
    });
  } catch (error) {
    return auditCheck({
      name: "missing X-PAYMENT-RESPONSE if applicable",
      severity: "FAIL",
      code: "x_payment_response_rejected",
      category: "retry",
      reason: error instanceof Error ? error.message : "X-PAYMENT-RESPONSE path failed.",
      fix: "Accept X-PAYMENT-RESPONSE where applicable, or document that only PAYMENT-RESPONSE is supported."
    });
  }
}

async function blocksPaidButDenied(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => challenge(SAFE_REQUIREMENT),
    paidFetch: async () => new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "PAYMENT-RESPONSE": "demo" }
    }),
    policy: SAFE_POLICY
  });

  try {
    await safeFetch("https://api.safe402.test/paid");
  } catch (error) {
    return expectSafe402Failure({
      error,
      name: "paid-but-denied risk analysis",
      passCode: "paid_but_denied_blocked",
      failCode: "paid_but_denied_allowed",
      passReason: "A denial response after payment was treated as a failed flow.",
      fix: "Fail paid responses that still deny access after payment."
    });
  }

  return auditCheck({
    name: "paid-but-denied risk analysis",
    severity: "CRITICAL",
    code: "paid_but_denied_allowed",
    category: "delivery",
    reason: "A denial response after payment was allowed.",
    fix: "Fail paid responses that still deny access after payment."
  });
}

function expectSafe402Failure(input: {
  error: unknown;
  name: string;
  passCode: string;
  failCode: string;
  passReason: string;
  fix: string;
}): Safe402AuditCheck {
  if (input.error instanceof Safe402Error && input.error.decision.status === "failed") {
    return auditCheck({
      name: input.name,
      severity: "PASS",
      code: input.passCode,
      category: "retry",
      reason: input.passReason,
      details: {
        decision: input.error.decision.status,
        safe402Reason: input.error.decision.reason
      }
    });
  }

  if (input.error instanceof Safe402Error && input.error.decision.status === "denied") {
    return auditCheck({
      name: input.name,
      severity: "PASS",
      code: input.passCode,
      category: "retry",
      reason: input.passReason,
      details: {
        decision: input.error.decision.status,
        safe402Reason: input.error.decision.reason
      }
    });
  }

  return auditCheck({
    name: input.name,
    severity: "FAIL",
    code: input.failCode,
    category: "retry",
    reason: "The simulated failure produced an unexpected result.",
    fix: input.fix
  });
}

function challenge(requirement: Safe402PaymentRequirement): Response {
  return new Response(JSON.stringify({ accepts: [requirement] }), {
    status: 402,
    headers: { "content-type": "application/json" }
  });
}
