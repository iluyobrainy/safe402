import {
  createSafe402Fetch,
  createMemoryReceiptStore,
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
        reason: `Expected 402 Payment Required, got ${response.status}.`
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
        : `Sensitive metadata may be present: ${privacyFindings.map(finding => finding.type).join(", ")}.`
    });
  } catch (error) {
    checks.push({
      name: `endpoint preflight ${endpoint}`,
      status: "fail",
      reason: error instanceof Error ? error.message : "Endpoint audit failed."
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
      details: { decision: decision.status }
    };
  }

  return {
    name: input.name,
    status: input.allowWarning ? "warn" : "fail",
    reason: `Expected ${input.expect}, got ${decision.status}: ${decision.reason}`,
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
        details: { decision: error.decision.status }
      };
    }

    return {
      name: "stops paid 402 retry loops",
      status: "fail",
      reason: "Retry fuse threw an unexpected error shape."
    };
  }

  return {
    name: "stops paid 402 retry loops",
    status: "fail",
    reason: "Retry fuse did not stop a repeated 402 response."
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
