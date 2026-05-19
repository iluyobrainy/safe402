import {
  createSafe402Fetch,
  createMemoryReceiptStore,
  createPaymentIntentFingerprint,
  evaluatePayment,
  extractPaymentRequirement,
  findSensitivePaymentMetadata,
  Safe402Error,
  type Safe402DecisionStatus,
  type Safe402PaymentRequirement,
  type Safe402Policy,
  type Safe402Receipt
} from "./index.js";

export type Safe402AuditStatus = "pass" | "fail" | "warn";

export type Safe402AuditCheck = {
  name: string;
  status: Safe402AuditStatus;
  reason: string;
  fix?: string;
  details?: Record<string, unknown>;
};

export type Safe402AuditCase = {
  name?: string;
  url: string;
  requirement: Safe402PaymentRequirement;
  expect?: Safe402DecisionStatus;
};

export type Safe402AuditOptions = {
  policy?: Safe402Policy;
  endpoints?: string[];
  cases?: Safe402AuditCase[];
  fetch?: typeof fetch;
};

export type Safe402AuditReport = {
  checks: Safe402AuditCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
};

const DEMO_PAY_TO = "0x0000000000000000000000000000000000000000";

const AUDIT_POLICY: Required<Pick<
  Safe402Policy,
  "maxPaymentUsd" |
  "dailyBudgetUsd" |
  "allowedDomains" |
  "allowedNetworks" |
  "allowedAssets" |
  "requireApprovalAboveUsd" |
  "duplicateWindowMs" |
  "blockSensitiveMetadata"
>> = {
  maxPaymentUsd: 0.1,
  dailyBudgetUsd: 0.15,
  allowedDomains: ["api.safe402.test"],
  allowedNetworks: ["base-sepolia"],
  allowedAssets: ["USDC"],
  requireApprovalAboveUsd: 0.05,
  duplicateWindowMs: 30 * 60 * 1000,
  blockSensitiveMetadata: true
};

export async function runSafe402Audit(options: Safe402AuditOptions = {}): Promise<Safe402AuditReport> {
  const checks: Safe402AuditCheck[] = [];

  checks.push(...await runBuiltInPolicyChecks());

  for (const auditCase of options.cases ?? []) {
    checks.push(await runCustomCase(auditCase, options.policy ?? {}));
  }

  for (const endpoint of options.endpoints ?? []) {
    checks.push(...await auditEndpoint(endpoint, options.policy ?? {}, options.fetch ?? globalThis.fetch));
  }

  return summarize(checks);
}

export function formatAuditReport(report: Safe402AuditReport): string {
  const lines = [
    "Safe402 audit",
    `Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`,
    ""
  ];

  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.name} - ${check.reason}`);
    if (check.fix && check.status !== "pass") {
      lines.push(`  fix: ${check.fix}`);
    }
  }

  return lines.join("\n");
}

async function runBuiltInPolicyChecks(): Promise<Safe402AuditCheck[]> {
  const checks: Safe402AuditCheck[] = [];

  checks.push(await expectDecision({
    name: "allows a normal x402 payment",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "0.01" }),
    policy: AUDIT_POLICY,
    expect: "approved"
  }));

  checks.push(await expectDecision({
    name: "blocks payment above per-call limit",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "0.25" }),
    policy: AUDIT_POLICY,
    expect: "denied"
  }));

  checks.push(await expectDecision({
    name: "blocks disallowed payment domain",
    url: "https://unknown.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "0.01" }),
    policy: AUDIT_POLICY,
    expect: "denied"
  }));

  checks.push(await expectDecision({
    name: "blocks unsupported payment network",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ network: "base", maxAmountRequired: "0.01" }),
    policy: AUDIT_POLICY,
    expect: "denied"
  }));

  checks.push(await expectDecision({
    name: "requires approval above threshold",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "0.075" }),
    policy: AUDIT_POLICY,
    expect: "approval_required"
  }));

  checks.push(await expectDailyBudgetBlock());
  checks.push(await expectDuplicateBlock());
  checks.push(await expectSensitiveMetadataBlock());
  checks.push(await expectRetryFuseBlock());
  checks.push(await expectChangedRecipientBlock());
  checks.push(await expectMutatedRetryBlock());
  checks.push(await expectMissingPaymentResponseHeaderBlock());
  checks.push(await expectPaidButDeniedBlock());
  checks.push(expectPaymentIntentFingerprint());

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

async function auditEndpoint(endpoint: string, policy: Safe402Policy, fetchImpl: typeof fetch): Promise<Safe402AuditCheck[]> {
  const checks: Safe402AuditCheck[] = [];

  try {
    const response = await fetchImpl(endpoint);

    if (response.status !== 402) {
      return [{
        name: `endpoint preflight ${endpoint}`,
        status: "warn",
        reason: `Expected 402 Payment Required, got ${response.status}.`,
        fix: "Point --url at an x402-protected resource that returns a 402 challenge before payment."
      }];
    }

    const requirement = await extractPaymentRequirement(response);
    checks.push(await expectDecision({
      name: `endpoint policy check ${endpoint}`,
      url: endpoint,
      requirement,
      policy,
      expect: "approved",
      allowWarning: true
    }));

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
  } catch (error) {
    checks.push({
      name: `endpoint preflight ${endpoint}`,
      status: "fail",
      reason: error instanceof Error ? error.message : "Endpoint audit failed.",
      fix: "Check the endpoint URL, local server, network, and whether the endpoint returns a valid x402 challenge."
    });
  }

  return checks;
}

async function expectDecision(input: {
  name: string;
  url: string;
  requirement: Safe402PaymentRequirement;
  policy: Safe402Policy;
  expect: Safe402DecisionStatus;
  receipts?: Safe402Receipt[];
  allowWarning?: boolean;
}): Promise<Safe402AuditCheck> {
  const decision = await evaluatePayment({
    url: new URL(input.url),
    requirement: input.requirement,
    policy: input.policy,
    receipts: createMemoryReceiptStore(input.receipts)
  });

  if (decision.status === input.expect) {
    return {
      name: input.name,
      status: "pass",
      reason: decision.reason,
      fix: undefined,
      details: { decision: decision.status }
    };
  }

  return {
    name: input.name,
    status: input.allowWarning ? "warn" : "fail",
    reason: `Expected ${input.expect}, got ${decision.status}: ${decision.reason}`,
    fix: "Update policy, payment requirement fields, or the expected audit case outcome so unsafe payments are blocked and safe payments pass.",
    details: { decision: decision.status }
  };
}

async function expectDailyBudgetBlock(): Promise<Safe402AuditCheck> {
  return expectDecision({
    name: "blocks payment that exceeds daily budget",
    url: "https://api.safe402.test/paid",
    requirement: requirement({ maxAmountRequired: "0.02" }),
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

async function expectDuplicateBlock(): Promise<Safe402AuditCheck> {
  const receipts = createMemoryReceiptStore();
  const url = new URL("https://api.safe402.test/paid");
  const paymentRequirement = requirement({ maxAmountRequired: "0.01" });
  const firstDecision = await evaluatePayment({
    url,
    requirement: paymentRequirement,
    policy: AUDIT_POLICY,
    receipts
  });

  await receipts.save({
    ...firstDecision,
    status: "paid",
    reason: "seeded duplicate receipt"
  });

  const secondDecision = await evaluatePayment({
    url,
    requirement: paymentRequirement,
    policy: AUDIT_POLICY,
    receipts
  });

  return {
    name: "blocks duplicate payment replay",
    status: secondDecision.status === "denied" ? "pass" : "fail",
    reason: secondDecision.reason,
    details: { decision: secondDecision.status }
  };
}

async function expectSensitiveMetadataBlock(): Promise<Safe402AuditCheck> {
  return expectDecision({
    name: "blocks sensitive payment metadata when enabled",
    url: "https://api.safe402.test/paid",
    requirement: requirement({
      maxAmountRequired: "0.01",
      resource: "https://api.safe402.test/paid?api_key=sk-test-secret",
      description: "Research for ada@example.com"
    }),
    policy: AUDIT_POLICY,
    expect: "denied"
  });
}

async function expectRetryFuseBlock(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement({ maxAmountRequired: "0.01" })] }), { status: 402 }),
    paidFetch: async () => new Response(JSON.stringify({ error: "still requires payment" }), { status: 402 }),
    policy: AUDIT_POLICY
  });

  try {
    await safeFetch("https://api.safe402.test/paid");
  } catch (error) {
    if (error instanceof Safe402Error && error.decision.status === "failed") {
      return {
        name: "stops paid 402 retry loops",
        status: "pass",
        reason: error.decision.reason,
        fix: undefined,
        details: { decision: error.decision.status }
      };
    }

    return {
      name: "stops paid 402 retry loops",
      status: "fail",
      reason: "Retry fuse threw an unexpected error shape.",
      fix: "Ensure repeated 402 responses after paid fetch are converted into Safe402Error failures."
    };
  }

  return {
    name: "stops paid 402 retry loops",
    status: "fail",
    reason: "Retry fuse did not stop a repeated 402 response.",
    fix: "Stop after a second 402 instead of allowing automatic paid retries to loop."
  };
}

async function expectChangedRecipientBlock(): Promise<Safe402AuditCheck> {
  return expectDecision({
    name: "blocks changed recipient address",
    url: "https://api.safe402.test/paid",
    requirement: requirement({
      maxAmountRequired: "0.01",
      payTo: "0x1111111111111111111111111111111111111111"
    }),
    policy: {
      ...AUDIT_POLICY,
      allowedPayTo: [DEMO_PAY_TO]
    },
    expect: "denied"
  });
}

async function expectMutatedRetryBlock(): Promise<Safe402AuditCheck> {
  const init: RequestInit = {
    method: "POST",
    body: "stable-body"
  };
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({
      accepts: [requirement({ maxAmountRequired: "0.075" })]
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
      return {
        name: "blocks mutated retry body",
        status: "pass",
        reason: error.decision.reason,
        details: { decision: error.decision.status }
      };
    }

    return {
      name: "blocks mutated retry body",
      status: "fail",
      reason: "Mutated retry test threw an unexpected error shape.",
      fix: "Compare request intent before the 402 challenge and before paid retry."
    };
  }

  return {
    name: "blocks mutated retry body",
    status: "fail",
    reason: "Mutated retry body was not blocked.",
    fix: "Fingerprint method, URL, and body before retrying paid fetch."
  };
}

async function expectMissingPaymentResponseHeaderBlock(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({
      accepts: [requirement({ maxAmountRequired: "0.01" })]
    }), { status: 402 }),
    paidFetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    policy: {
      ...AUDIT_POLICY,
      requirePaymentResponseHeader: true
    }
  });

  try {
    await safeFetch("https://api.safe402.test/paid");
  } catch (error) {
    if (error instanceof Safe402Error && error.decision.status === "failed") {
      return {
        name: "blocks missing PAYMENT-RESPONSE header",
        status: "pass",
        reason: error.decision.reason,
        details: { decision: error.decision.status }
      };
    }

    return {
      name: "blocks missing PAYMENT-RESPONSE header",
      status: "fail",
      reason: "Missing header test threw an unexpected error shape.",
      fix: "Require paid responses to include PAYMENT-RESPONSE when policy demands receipt proof."
    };
  }

  return {
    name: "blocks missing PAYMENT-RESPONSE header",
    status: "fail",
    reason: "Paid response without PAYMENT-RESPONSE was not blocked.",
    fix: "Check the paid response for PAYMENT-RESPONSE or X-PAYMENT-RESPONSE before marking the flow paid."
  };
}

async function expectPaidButDeniedBlock(): Promise<Safe402AuditCheck> {
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({
      accepts: [requirement({ maxAmountRequired: "0.01" })]
    }), { status: 402 }),
    paidFetch: async () => new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "PAYMENT-RESPONSE": "demo" }
    }),
    policy: AUDIT_POLICY
  });

  try {
    await safeFetch("https://api.safe402.test/paid");
  } catch (error) {
    if (error instanceof Safe402Error && error.decision.status === "failed") {
      return {
        name: "blocks paid-but-denied responses",
        status: "pass",
        reason: error.decision.reason,
        details: { decision: error.decision.status }
      };
    }

    return {
      name: "blocks paid-but-denied responses",
      status: "fail",
      reason: "Paid-but-denied test threw an unexpected error shape.",
      fix: "Treat configured denial status codes after payment as failed flows."
    };
  }

  return {
    name: "blocks paid-but-denied responses",
    status: "fail",
    reason: "403 paid response was not blocked.",
    fix: "Fail paid responses that still deny access after payment."
  };
}

function expectPaymentIntentFingerprint(): Safe402AuditCheck {
  const first = createPaymentIntentFingerprint({
    input: "https://api.safe402.test/paid",
    init: { method: "POST", body: "task=a" },
    requirement: requirement({ maxAmountRequired: "0.01" })
  });
  const second = createPaymentIntentFingerprint({
    input: "https://api.safe402.test/paid",
    init: { method: "POST", body: "task=b" },
    requirement: requirement({ maxAmountRequired: "0.01" })
  });

  return {
    name: "fingerprints payment intent",
    status: first !== second ? "pass" : "fail",
    reason: first !== second
      ? "Different request bodies produce different payment intent fingerprints."
      : "Different request bodies produced the same payment intent fingerprint.",
    fix: first !== second
      ? undefined
      : "Include method, URL, body summary, payee, asset, amount, and resource in the intent fingerprint."
  };
}

function requirement(overrides: Partial<Safe402PaymentRequirement>): Safe402PaymentRequirement {
  return {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    payTo: DEMO_PAY_TO,
    maxAmountRequired: "0.01",
    resource: "https://api.safe402.test/paid",
    ...overrides
  };
}

function summarize(checks: Safe402AuditCheck[]): Safe402AuditReport {
  return {
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter(check => check.status === "pass").length,
      failed: checks.filter(check => check.status === "fail").length,
      warnings: checks.filter(check => check.status === "warn").length
    }
  };
}
