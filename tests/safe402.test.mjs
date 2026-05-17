import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  AuditQuoteEngine,
  DisabledBillingProvider,
  MockBillingProvider,
  PROBE_PRICE_USD,
  Safe402Error,
  X402BillingProvider,
  createJsonFileBillingReceiptStore,
  createMemoryBillingReceiptStore,
  createAuditJsonReport,
  createProbeJsonReport,
  createSafe402Audit,
  createMemoryReceiptStore,
  createPaymentIntentFingerprint,
  createSafe402Probe,
  createSafe402Fetch,
  defaultPolicy,
  describeProbePricing,
  evaluatePayment,
  findSensitivePaymentMetadata,
  loadPolicy,
  parseRequirementAmount,
  quoteAuditBilling,
  quoteProbeBilling,
  resolveBillingConfig
} from "../dist/index.js";
import { quoteAudit, runSafe402Audit } from "../dist/audit.js";
import { formatProbeMarkdownReport, runProbe } from "../dist/probe/index.js";
import { createSafe402McpTools } from "../dist/mcp.js";
import { createJsonFileReceiptStore } from "../dist/node.js";

const execFileAsync = promisify(execFile);
const cliPath = join(process.cwd(), "dist", "cli.js");

const requirement = {
  scheme: "exact",
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x0000000000000000000000000000000000000000",
  maxAmountRequired: "10000",
  resource: "https://api.example.com/paid-data"
};

test("parses x402 atomic USDC amounts", () => {
  const parsed = parseRequirementAmount(requirement);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.amountUsd, 0.01);
});

test("denies a payment above policy limit", async () => {
  const decision = await evaluatePayment({
    url: new URL("https://api.example.com/paid-data"),
    requirement,
    policy: {
      maxPaymentUsd: 0.001
    },
    receipts: createMemoryReceiptStore()
  });

  assert.equal(decision.status, "denied");
  assert.match(decision.reason, /exceeds per-call/);
});

test("blocks duplicate payments inside the duplicate window", async () => {
  const receipts = createMemoryReceiptStore();
  const url = new URL("https://api.example.com/paid-data");
  const firstDecision = await evaluatePayment({
    url,
    requirement,
    policy: {},
    receipts
  });

  await receipts.save({
    ...firstDecision,
    status: "paid",
    reason: "seed paid receipt"
  });

  const secondDecision = await evaluatePayment({
    url,
    requirement,
    policy: {},
    receipts
  });

  assert.equal(secondDecision.status, "denied");
  assert.equal(secondDecision.reason, "Duplicate payment attempt blocked.");
});

test("detects sensitive payment metadata", () => {
  const findings = findSensitivePaymentMetadata({
    ...requirement,
    resource: "https://api.example.com/search?api_key=sk-test-secret",
    description: "research for user@example.com"
  });

  assert.deepEqual(findings.map(finding => finding.type), ["sensitive_query", "email"]);
});

test("safeFetch stops a repeated 402 after paid fetch", async () => {
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 }),
    paidFetch: async () => new Response("still payment required", { status: 402 }),
    policy: {
      maxPaymentUsd: 0.1
    }
  });

  await assert.rejects(
    safeFetch("https://api.example.com/paid-data"),
    error => error instanceof Safe402Error && error.decision.status === "failed"
  );
});

test("safeFetch blocks changed request intent before paid retry", async () => {
  const init = {
    method: "POST",
    body: "stable-body"
  };
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({ accepts: [{ ...requirement, maxAmountRequired: "75000" }] }), { status: 402 }),
    paidFetch: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "PAYMENT-RESPONSE": "demo" }
    }),
    policy: {
      maxPaymentUsd: 0.1,
      requireApprovalAboveUsd: 0.05
    },
    onApprovalRequired: async () => {
      init.body = "mutated-body";
      return true;
    }
  });

  await assert.rejects(
    safeFetch("https://api.example.com/paid-data", init),
    error => error instanceof Safe402Error && /Request intent changed/.test(error.decision.reason)
  );
});

test("safeFetch can require PAYMENT-RESPONSE header", async () => {
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 }),
    paidFetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    policy: {
      maxPaymentUsd: 0.1,
      requirePaymentResponseHeader: true
    }
  });

  await assert.rejects(
    safeFetch("https://api.example.com/paid-data"),
    error => error instanceof Safe402Error && /missing PAYMENT-RESPONSE/.test(error.decision.reason)
  );
});

test("safeFetch fails paid-but-denied responses", async () => {
  const safeFetch = createSafe402Fetch({
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 }),
    paidFetch: async () => new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "PAYMENT-RESPONSE": "demo" }
    }),
    policy: {
      maxPaymentUsd: 0.1
    }
  });

  await assert.rejects(
    safeFetch("https://api.example.com/paid-data"),
    error => error instanceof Safe402Error && /paid-but-denied/.test(error.decision.reason)
  );
});

test("payment intent fingerprint changes when request body changes", () => {
  const first = createPaymentIntentFingerprint({
    input: "https://api.example.com/paid-data",
    init: { method: "POST", body: "task=a" },
    requirement
  });
  const second = createPaymentIntentFingerprint({
    input: "https://api.example.com/paid-data",
    init: { method: "POST", body: "task=b" },
    requirement
  });

  assert.notEqual(first, second);
});

test("audit passes built-in checks", async () => {
  const report = await runSafe402Audit();

  assert.equal(report.kind, "audit");
  assert.equal(report.verdict, "SAFE_TO_PAY");
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 0);
  assert.ok(report.summary.passed >= 14);
});

test("audit reports invalid x402 when the challenge is malformed", async () => {
  const report = await runSafe402Audit({
    endpoints: ["https://api.example.com/broken-paid-data"],
    fetch: async () => new Response(JSON.stringify({ accepts: [{}] }), { status: 402 })
  });

  assert.equal(report.kind, "audit");
  assert.equal(report.verdict, "INVALID_X402");
  assert.ok(report.summary.failed > 0);
  assert.ok(report.checks.some(check => check.code === "invalid_x402_challenge"));
});

test("standard audit detects repeated challenge mutation", async () => {
  let calls = 0;
  const stable = {
    ...requirement,
    paymentIdentifier: "pay-1",
    idempotencyKey: "idem-1"
  };
  const mutatedPayee = {
    ...stable,
    payTo: "0x1111111111111111111111111111111111111111"
  };
  const mutatedAmount = {
    ...stable,
    maxAmountRequired: "20000"
  };

  const report = await runSafe402Audit({
    profile: "standard",
    endpoints: ["https://api.example.com/mutating-paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"]
    },
    fetch: async () => {
      calls += 1;
      const challenge = calls === 1
        ? stable
        : calls === 2
          ? mutatedPayee
          : mutatedAmount;
      return new Response(JSON.stringify({ accepts: [challenge] }), { status: 402 });
    }
  });

  assert.equal(report.verdict, "NOT_SAFE_TO_AUTOPAY");
  assert.ok(report.checks.some(check => check.code === "pay_to_changed"));
  assert.ok(report.checks.some(check => check.code === "amount_changed"));
});

test("audit detects price mismatch and sensitive metadata", async () => {
  const report = await runSafe402Audit({
    endpoints: ["https://api.example.com/leaky-paid-data"],
    policy: {
      maxPaymentUsd: 10,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"],
      blockSensitiveMetadata: true
    },
    fetch: async () => new Response(JSON.stringify({
      accepts: [{
        ...requirement,
        description: "Private customer research for ada@example.com. Price is $2.00.",
        resource: "https://api.example.com/paid-data?api_key=sk-test-secret"
      }]
    }), { status: 402 })
  });

  assert.equal(report.verdict, "NOT_SAFE_TO_AUTOPAY");
  assert.ok(report.checks.some(check => check.code === "description_price_mismatch"));
  assert.ok(report.checks.some(check => check.code === "api_key_in_metadata"));
  assert.ok(report.recommendedFixes.some(fix => /Match human price/.test(fix)));
});

test("deep audit runs MCP tool checks", async () => {
  const report = await runSafe402Audit({
    profile: "deep",
    mcpManifests: [{
      name: "paid-tools",
      tools: [{
        name: "search",
        description: "Private customer search for ada@example.com",
        priceUsd: 0.02,
        removed: true,
        paymentRequirement: requirement
      }]
    }]
  });

  assert.equal(report.verdict, "NOT_SAFE_TO_AUTOPAY");
  assert.ok(report.checks.some(check => check.code === "mcp_tool_price_mismatch"));
  assert.ok(report.checks.some(check => check.code === "mcp_tool_removed_after_discovery"));
  assert.ok(report.checks.some(check => check.code === "mcp_tool_description_leaks"));
});

test("audit pauses for additional MCP scan payment when scope exceeds quote", async () => {
  const quote = quoteAudit({
    profile: "deep",
    mcpServers: 0
  });
  const report = await runSafe402Audit({
    profile: "deep",
    quote,
    mcpManifests: [{
      name: "extra-paid-tools",
      tools: [{
        name: "search",
        priceUsd: 0.01,
        paymentRequirement: requirement
      }]
    }]
  });

  assert.equal(report.verdict, "NEEDS_APPROVAL");
  assert.equal(report.additionalPaymentRequired.code, "ADDITIONAL_PAYMENT_REQUIRED");
  assert.equal(report.additionalPaymentRequired.additionalUsd, 1);
  assert.ok(report.checks.some(check => check.code === "additional_payment_required"));
});

test("probe inspects an x402 endpoint without paying", async () => {
  const report = await runProbe({
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"]
    },
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 })
  });

  assert.equal(report.kind, "probe");
  assert.equal(report.summary.failed, 0);
  assert.equal(report.probes[0].category, "APPROVED");
  assert.equal(report.probes[0].decision.status, "approved");
});

test("probe evaluates all accepts options and chooses the best compatible one", async () => {
  const report = await runProbe({
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 0.25,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"],
      allowedPayees: ["0x0000000000000000000000000000000000000000"]
    },
    fetch: async () => new Response(JSON.stringify({
      accepts: [
        { ...requirement, maxAmountRequired: "1000000" },
        { ...requirement, maxAmountRequired: "10000" }
      ]
    }), { status: 402 })
  });

  assert.equal(report.probes[0].options.length, 2);
  assert.equal(report.probes[0].category, "APPROVED");
  assert.equal(report.probes[0].selectedOption.option.index, 1);
  assert.equal(report.probes[0].selectedOption.amountUsd, 0.01);
});

test("probe returns all blocked accepts options with reasons", async () => {
  const report = await runProbe({
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 0.25,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"],
      blockedPayees: ["0x9999999999999999999999999999999999999999"]
    },
    fetch: async () => new Response(JSON.stringify({
      accepts: [
        { ...requirement, asset: "DAI", maxAmountRequired: "10000" },
        { ...requirement, payTo: "0x9999999999999999999999999999999999999999", maxAmountRequired: "10000" }
      ]
    }), { status: 402 })
  });

  assert.equal(report.probes[0].category, "BLOCKED_BY_POLICY");
  assert.equal(report.probes[0].options.length, 2);
  assert.match(report.probes[0].options[0].blockedReasons.join(" "), /Asset DAI is not allowed/);
  assert.match(report.probes[0].options[1].blockedReasons.join(" "), /blocked/);
});

test("probe extracts requirements from WWW-Authenticate", async () => {
  const challenge = Buffer.from(JSON.stringify({ accepts: [requirement] })).toString("base64");
  const report = await runProbe({
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"]
    },
    fetch: async () => new Response("payment required", {
      status: 402,
      headers: {
        "WWW-Authenticate": `x402 payment_required="${challenge}"`
      }
    })
  });

  assert.equal(report.probes[0].category, "APPROVED");
  assert.equal(report.probes[0].paymentOptions[0].source, "WWW-Authenticate");
});

test("probe parses 402 requirements from payment headers and body", async () => {
  const headerReport = await runProbe({
    endpoints: ["https://api.example.com/header-paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"]
    },
    fetch: async () => new Response("payment required", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": JSON.stringify({ accepts: [requirement] })
      }
    })
  });
  const bodyRequirement = {
    ...requirement,
    resource: "https://api.example.com/body-paid-data"
  };
  const bodyReport = await runProbe({
    endpoints: ["https://api.example.com/body-paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"]
    },
    fetch: async () => new Response(JSON.stringify({
      paymentRequirements: [bodyRequirement]
    }), { status: 402 })
  });

  assert.equal(headerReport.probes[0].category, "APPROVED");
  assert.equal(headerReport.probes[0].paymentOptions[0].source, "PAYMENT-REQUIRED");
  assert.equal(bodyReport.probes[0].category, "APPROVED");
  assert.equal(bodyReport.probes[0].paymentOptions[0].source, "body");
  assert.equal(bodyReport.probes[0].requirement.resource, "https://api.example.com/body-paid-data");
});

test("probe evaluates all accepts and reports unsupported rails", async () => {
  const report = await runProbe({
    endpoints: ["https://api.example.com/rail-choice"],
    policy: {
      maxPaymentUsd: 0.25,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"],
      allowedPayees: [requirement.payTo]
    },
    fetch: async () => new Response(JSON.stringify({
      accepts: [
        { ...requirement, network: "polygon", asset: "DAI" },
        { ...requirement, network: "base-sepolia", asset: "USDC" }
      ]
    }), { status: 402 })
  });

  assert.equal(report.probes[0].options.length, 2);
  assert.equal(report.probes[0].options[0].category, "BLOCKED_BY_POLICY");
  assert.ok(report.probes[0].options[0].policy.reasons.some(reason => reason.code === "network_not_allowed"));
  assert.ok(report.probes[0].options[0].policy.reasons.some(reason => reason.code === "asset_not_allowed"));
  assert.equal(report.probes[0].category, "APPROVED");
  assert.equal(report.probes[0].selectedOption.option.index, 1);
});

test("probe flags amount ambiguity and sensitive metadata", async () => {
  const report = await runProbe({
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 1,
      allowedDomains: ["api.example.com"],
      blockSensitiveMetadata: false
    },
    fetch: async () => new Response(JSON.stringify({
      accepts: [{
        ...requirement,
        maxAmountRequired: "10000",
        description: "Private customer research for ada@example.com. Price is $2.00."
      }]
    }), { status: 402 })
  });

  const option = report.probes[0].options[0];
  assert.equal(report.probes[0].category, "SUSPICIOUS");
  assert.ok(option.amountAmbiguityFindings.some(finding => finding.code === "description_price_mismatch"));
  assert.ok(option.privacyFindings.some(finding => finding.type === "email"));
  assert.ok(option.privacyFindings.some(finding => finding.type === "private_task_reason"));
});

test("probe returns invalid x402 for malformed 402 challenges", async () => {
  const report = await runProbe({
    endpoints: ["https://api.example.com/malformed-paid-data"],
    fetch: async () => new Response(JSON.stringify({ accepts: [] }), { status: 402 })
  });

  assert.equal(report.probes[0].category, "INVALID_X402");
  assert.equal(report.probes[0].paymentOptions.length, 0);
  assert.match(report.probes[0].explanation, /could not find a usable x402 payment requirement/i);
});

test("probe classifies non-x402 and unreachable endpoints", async () => {
  const freeReport = await runProbe({
    endpoints: ["https://api.example.com/free"],
    fetch: async () => new Response("ok", { status: 200 })
  });
  const authReport = await runProbe({
    endpoints: ["https://api.example.com/auth"],
    fetch: async () => new Response("auth", { status: 401 })
  });
  const networkReport = await runProbe({
    endpoints: ["https://api.example.com/down"],
    fetch: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });

  assert.equal(freeReport.probes[0].category, "FREE_OR_NOT_GATED");
  assert.equal(authReport.probes[0].category, "INVALID_X402");
  assert.equal(authReport.probes[0].nonX402Status, "auth_required");
  assert.equal(networkReport.probes[0].category, "UNREACHABLE");
  assert.equal(networkReport.probes[0].nonX402Status, "network_error");
});

test("probe markdown report is available", async () => {
  const report = await runProbe({
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"]
    },
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 })
  });
  const markdown = formatProbeMarkdownReport(report);

  assert.match(markdown, /# Safe402 Probe Report/);
  assert.match(markdown, /`APPROVED`/);
});

test("public factories, quotes, and policy defaults are available", async () => {
  const probe = createSafe402Probe({
    endpoints: ["https://api.example.com/paid-data"],
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 }),
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"]
    }
  });
  const audit = createSafe402Audit();
  const policy = loadPolicy({ maxPaymentUsd: 0.1 });

  assert.equal(defaultPolicy.blockPaymentIntentChanges, true);
  assert.deepEqual(policy.failOnPaidStatusCodes, [401, 403]);
  assert.equal(probe.quote().estimatedPayments, 0);
  assert.equal(audit.quote().profile, "basic");
  assert.equal(audit.quote().totalUsd, 0.5);
  assert.equal((await probe.run()).summary.failed, 0);
});

test("probe pricing constants are exported", () => {
  assert.equal(PROBE_PRICE_USD, 0.01);
  assert.match(describeProbePricing(2), /\$0\.02 for 2 endpoint checks/);
});

test("probe JSON report uses careful blocked-by-policy language", async () => {
  const expensiveRequirement = {
    ...requirement,
    maxAmountRequired: "2000000",
    description: "Paid data. Price is $2.00."
  };
  const report = await runProbe({
    endpoints: ["https://api.example.com/expensive-paid-data"],
    policy: {
      maxPaymentUsd: 0.25,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"]
    },
    fetch: async () => new Response(JSON.stringify({ accepts: [expensiveRequirement] }), { status: 402 })
  });
  const json = createProbeJsonReport(report, { generatedAt: "2026-05-17T00:00:00.000Z" });

  assert.equal(json.reportType, "probe");
  assert.equal(json.generatedAt, "2026-05-17T00:00:00.000Z");
  assert.equal(json.targetUrl, "https://api.example.com/expensive-paid-data");
  assert.equal(json.method, "GET");
  assert.equal(json.x402Detected, true);
  assert.equal(json.paymentRequirementsFound, 1);
  assert.equal(json.status, "BLOCKED_BY_POLICY");
  assert.equal(json.amountUsd, 2);
  assert.equal(json.network, "base-sepolia");
  assert.equal(json.asset, "USDC");
  assert.equal(json.payTo, requirement.payTo);
  assert.equal(json.resource, requirement.resource);
  assert.equal(json.description, "Paid data. Price is $2.00.");
  assert.equal(json.policyDecision.status, "denied");
  assert.equal(json.billing.product, "probe");
  assert.equal(json.billing.priceUsd, 0.01);
  assert.equal(json.finalRecommendation, "Blocked by policy. Endpoint requested $2.00, but your max auto-spend is $0.25. This does not mean the provider is malicious.");
  assert.doesNotMatch(json.finalRecommendation, /unsafe endpoint/i);
});

test("billing quote engines and mock provider collect probe receipts", async () => {
  const quote = quoteProbeBilling({ endpointChecks: 2 });
  const store = createMemoryBillingReceiptStore();
  const provider = new MockBillingProvider(resolveBillingConfig({ mode: "mock" }), store);
  const receipt = await provider.collect({ quote });
  const receipts = await store.list();

  assert.equal(quote.kind, "billing_quote");
  assert.equal(quote.product, "probe");
  assert.equal(quote.totalUsd, 0.02);
  assert.equal(receipt.kind, "billing_receipt");
  assert.equal(receipt.mode, "mock");
  assert.equal(receipt.paid, true);
  assert.equal(receipt.amountUsd, 0.02);
  assert.equal(receipts.length, 1);
});

test("disabled billing does not block local probe execution", async () => {
  const quote = quoteProbeBilling({ endpointChecks: 1 });
  const store = createMemoryBillingReceiptStore();
  const provider = new DisabledBillingProvider(resolveBillingConfig({ mode: "disabled" }), store);
  const receipt = await provider.collect({ quote });
  const receipts = await store.list();

  assert.equal(quote.totalUsd, 0.01);
  assert.equal(receipt.mode, "disabled");
  assert.equal(receipt.required, false);
  assert.equal(receipt.paid, false);
  assert.equal(receipt.verificationStatus, "disabled");
  assert.match(receipt.message, /local testing continues without payment/);
  assert.equal(receipts.length, 1);
});

test("audit quote engine converts audit quotes into billing quotes", () => {
  const auditQuote = quoteAudit({
    profile: "deep",
    endpoints: ["https://api.example.com/paid-data"],
    requestVariants: 1,
    mcpServers: 1
  });
  const quote = new AuditQuoteEngine().quote(auditQuote);

  assert.equal(quote.kind, "billing_quote");
  assert.equal(quote.product, "audit");
  assert.equal(quote.totalUsd, 6.25);
  assert.equal(quote.metadata.profile, "deep");
  assert.equal(quote.metadata.mcpScanEnabled, true);
});

test("normalized reports include probe and audit billing sections", async () => {
  const probeBilling = await new MockBillingProvider(
    resolveBillingConfig({ mode: "mock" }),
    createMemoryBillingReceiptStore()
  ).collect({ quote: quoteProbeBilling({ endpointChecks: 1 }) });
  const probeReport = await runProbe({
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"]
    },
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 })
  });
  const auditReport = await runSafe402Audit({
    profile: "basic",
    billing: await new MockBillingProvider(
      resolveBillingConfig({ mode: "mock" }),
      createMemoryBillingReceiptStore()
    ).collect({ quote: quoteAuditBilling(quoteAudit({ profile: "basic" })) })
  });
  const probeJson = createProbeJsonReport({ ...probeReport, billing: probeBilling });
  const auditJson = createAuditJsonReport(auditReport);

  assert.equal(probeJson.billing.product, "probe");
  assert.equal(probeJson.billing.priceUsd, 0.01);
  assert.equal(probeJson.billing.billingMode, "mock");
  assert.equal(probeJson.billing.receipt.kind, "billing_receipt");
  assert.equal(auditJson.billingReceipt.product, "audit");
  assert.equal(auditJson.billingReceipt.amountUsd, 0.5);
});

test("audit JSON report exposes matrix, check IDs, simulations, and CI status", async () => {
  const report = await runSafe402Audit({ profile: "standard" });
  const json = createAuditJsonReport(report, { generatedAt: "2026-05-17T00:00:00.000Z" });

  assert.equal(json.reportType, "audit");
  assert.equal(json.generatedAt, "2026-05-17T00:00:00.000Z");
  assert.equal(json.profile, "standard");
  assert.equal(json.finalVerdict, "SAFE_TO_PAY");
  assert.equal(json.ciStatus, "pass");
  assert.ok(json.testMatrix.some(item => item.category === "retry"));
  assert.ok(json.individualChecks.some(check => check.id === "VALID_402_CHALLENGE"));
  assert.ok(json.individualChecks.some(check => check.id === "PAYMENT_INTENT_STABLE"));
  assert.match(json.paymentIntentFingerprint, /^fnv1a:/);
  assert.ok(json.repeatedChallengeStabilityResults.length > 0);
  assert.ok(json.retryLoopSimulationResults.length > 0);
  assert.ok(json.duplicatePaymentSimulationResults.length > 0);
  assert.ok(Array.isArray(json.metadataAndPrivacyFindings));
  assert.ok(Array.isArray(json.remediationChecklist));
});

test("x402 billing provider verifies exact proof details", async () => {
  const config = resolveBillingConfig({
    mode: "x402",
    payTo: "0x0000000000000000000000000000000000000042",
    network: "base-sepolia",
    asset: "USDC"
  });
  const provider = new X402BillingProvider(config, createMemoryBillingReceiptStore());
  const quote = quoteProbeBilling({ endpointChecks: 1 });
  const proof = JSON.stringify({
    amountUsd: 0.01,
    payTo: config.payTo,
    network: config.network,
    asset: config.asset,
    transactionId: "0xtest"
  });

  const receipt = await provider.collect({ quote, proof });

  assert.equal(receipt.mode, "x402");
  assert.equal(receipt.paid, true);
  assert.equal(receipt.transactionId, "0xtest");
  assert.equal(receipt.verificationStatus, "x402_verified");

  await assert.rejects(
    provider.collect({
      quote,
      proof: JSON.stringify({
        amountUsd: 0.02,
        payTo: config.payTo,
        network: config.network,
        asset: config.asset
      })
    }),
    /does not match exact quote/
  );
});

test("audit quote engine prices profiles and add-ons", () => {
  const quote = quoteAudit({
    profile: "standard",
    endpoints: ["https://api.example.com/a", "https://api.example.com/b"],
    requestVariants: 2,
    mcpServers: 1,
    hostedReport: true
  });

  assert.equal(quote.kind, "audit_quote");
  assert.equal(quote.profile, "standard");
  assert.equal(quote.endpointsCount, 2);
  assert.equal(quote.requestVariantsCount, 2);
  assert.equal(quote.mcpScanEnabled, true);
  assert.equal(quote.hostedReportEnabled, true);
  assert.equal(quote.totalUsd, 7.5);
  assert.ok(quote.includedChecks.includes("payTo mutation check"));
});

test("audit quote profiles price per endpoint", () => {
  const basic = quoteAudit({
    profile: "basic",
    endpoints: ["https://api.example.com/a"]
  });
  const standard = quoteAudit({
    profile: "standard",
    endpoints: ["https://api.example.com/a"]
  });
  const deep = quoteAudit({
    profile: "deep",
    endpoints: ["https://api.example.com/a"]
  });
  const twoEndpointDeep = quoteAudit({
    profile: "deep",
    endpoints: ["https://api.example.com/a", "https://api.example.com/b"]
  });

  assert.equal(basic.totalUsd, 0.5);
  assert.equal(standard.totalUsd, 2.5);
  assert.equal(deep.totalUsd, 5);
  assert.equal(twoEndpointDeep.totalUsd, 10);
  assert.equal(twoEndpointDeep.endpointsCount, 2);
});

test("audit detects missing identifiers, duplicate protection, and retry-loop checks", async () => {
  const report = await runSafe402Audit({
    profile: "standard",
    endpoints: ["https://api.example.com/paid-data"],
    policy: {
      maxPaymentUsd: 0.1,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"]
    },
    fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 })
  });

  assert.equal(report.verdict, "SAFE_WITH_WARNINGS");
  assert.ok(report.checks.some(check => check.code === "payment_identifier_missing" && check.severity === "WARN"));
  assert.ok(report.checks.some(check => check.code === "idempotency_missing" && check.severity === "WARN"));
  assert.ok(report.checks.some(check => check.code === "duplicate_retry_blocked" && check.severity === "PASS"));
  assert.ok(report.checks.some(check => check.category === "retry" && check.code === "repeated_402_retry_fused"));
});

test("audit privacy severity distinguishes PII warnings from secret leaks", async () => {
  const piiReport = await runSafe402Audit({
    endpoints: ["https://api.example.com/pii-paid-data"],
    policy: {
      maxPaymentUsd: 10,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"],
      blockSensitiveMetadata: true
    },
    fetch: async () => new Response(JSON.stringify({
      accepts: [{
        ...requirement,
        description: "Paid research for ada@example.com."
      }]
    }), { status: 402 })
  });
  const secretReport = await runSafe402Audit({
    endpoints: ["https://api.example.com/secret-paid-data"],
    policy: {
      maxPaymentUsd: 10,
      allowedDomains: ["api.example.com"],
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"]
    },
    fetch: async () => new Response(JSON.stringify({
      accepts: [{
        ...requirement,
        resource: "https://api.example.com/paid-data?api_key=sk-test-secret"
      }]
    }), { status: 402 })
  });

  assert.ok(piiReport.checks.some(check => check.code === "pii_in_description" && check.severity === "WARN"));
  assert.equal(piiReport.verdict, "SAFE_WITH_WARNINGS");
  assert.ok(secretReport.checks.some(check => check.code === "api_key_in_metadata" && check.severity === "CRITICAL"));
  assert.equal(secretReport.verdict, "NOT_SAFE_TO_AUTOPAY");
});

test("MCP tools expose check, receipts, and budget handlers", async () => {
  const receipts = createMemoryReceiptStore();
  const tools = createSafe402McpTools({
    receipts,
    policy: {
      maxPaymentUsd: 0.1,
      dailyBudgetUsd: 1
    }
  });

  const decision = await tools.safe402_check_payment.handler({
    url: "https://api.example.com/paid-data",
    requirement
  });
  const budget = await tools.safe402_get_budget.handler({});

  assert.equal(decision.status, "approved");
  assert.equal(budget.dailyBudgetUsd, 1);
  assert.equal(budget.spentTodayUsd, 0);
});

test("JSON file receipt store persists receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "safe402-"));
  const path = join(directory, "receipts.json");

  try {
    const store = createJsonFileReceiptStore({ path });
    await store.save({
      status: "paid",
      reason: "test receipt",
      url: "https://api.example.com/paid-data",
      domain: "api.example.com",
      amountUsd: 0.01,
      timestamp: new Date().toISOString()
    });

    const reloadedStore = createJsonFileReceiptStore({ path });
    const receipts = await reloadedStore.list();

    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].status, "paid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON file billing receipt store persists billing receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "safe402-billing-"));
  const path = join(directory, "billing-receipts.json");

  try {
    const store = createJsonFileBillingReceiptStore({ path });
    const provider = new MockBillingProvider(resolveBillingConfig({ mode: "mock" }), store);

    await provider.collect({ quote: quoteProbeBilling({ endpointChecks: 1 }) });

    const reloadedStore = createJsonFileBillingReceiptStore({ path });
    const receipts = await reloadedStore.list();

    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].kind, "billing_receipt");
    assert.equal(receipts[0].product, "probe");
    assert.equal(receipts[0].paid, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI help exits successfully", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"]);

  assert.match(stdout, /safe402 audit/);
  assert.match(stdout, /safe402 probe/);
  assert.match(stdout, /safe402 policy init/);
});

test("CLI audit JSON output is machine-readable", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "audit", "--json"]);
  const report = JSON.parse(stdout);

  assert.equal(report.quote.profile, "basic");
  assert.equal(report.billing.mode, "disabled");
  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.passed >= 14);
});

test("CLI audit quote returns profile pricing", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "audit",
    "quote",
    "https://api.example.com/paid-data",
    "--profile",
    "deep",
    "--request-variants",
    "2",
    "--mcp-servers",
    "1",
    "--hosted-report",
    "--json"
  ]);
  const quote = JSON.parse(stdout);

  assert.equal(quote.profile, "deep");
  assert.equal(quote.endpointsCount, 1);
  assert.equal(quote.requestVariantsCount, 2);
  assert.equal(quote.mcpScanEnabled, true);
  assert.equal(quote.hostedReportEnabled, true);
  assert.equal(quote.totalUsd, 7.5);
  assert.ok(quote.includedChecks.includes("CI-grade full report"));
});

test("CLI audit quote with profile standard works", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "audit",
    "quote",
    "https://api.example.com/paid-data",
    "--profile",
    "standard",
    "--json"
  ]);
  const quote = JSON.parse(stdout);

  assert.equal(quote.profile, "standard");
  assert.equal(quote.endpointsCount, 1);
  assert.equal(quote.totalUsd, 2.5);
  assert.ok(quote.includedChecks.includes("duplicate retry simulation"));
});

test("CLI audit run attaches quote and billing receipt", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "audit",
    "--profile",
    "standard",
    "--billing-mode",
    "mock",
    "--json"
  ]);
  const report = JSON.parse(stdout);

  assert.equal(report.quote.profile, "standard");
  assert.equal(report.quote.totalUsd, 2.5);
  assert.equal(report.billing.kind, "billing_receipt");
  assert.equal(report.billing.mode, "mock");
  assert.equal(report.billing.paid, true);
  assert.equal(report.billing.amountUsd, 2.5);
  assert.equal(report.summary.failed, 0);
});

test("CLI audit with profile basic works", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "audit",
    "--profile",
    "basic",
    "--json"
  ]);
  const report = JSON.parse(stdout);

  assert.equal(report.reportType, "audit");
  assert.equal(report.profile, "basic");
  assert.equal(report.quote.totalUsd, 0.5);
  assert.equal(report.billing.mode, "disabled");
  assert.equal(report.verdict, "SAFE_TO_PAY");
});

test("CLI audit accepts CI critical fail-on mode", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "audit",
    "--profile",
    "standard",
    "--ci",
    "--fail-on",
    "critical",
    "--json"
  ]);
  const report = JSON.parse(stdout);

  assert.equal(report.profile, "standard");
  assert.equal(report.verdict, "SAFE_TO_PAY");
  assert.equal(report.summary.failed, 0);
});

test("CLI audit loads MCP manifest files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "safe402-mcp-audit-"));
  const manifestPath = join(directory, "mcp.json");

  try {
    await writeFile(manifestPath, JSON.stringify({
      name: "cli-paid-tools",
      tools: [{
        name: "lookup",
        description: "Paid lookup tool.",
        priceUsd: 0.01,
        resultBinding: "tool-call-id",
        paymentRequirement: requirement
      }]
    }), "utf8");

    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "audit",
      "--profile",
      "deep",
      "--mcp-manifest",
      manifestPath,
      "--json"
    ]);
    const report = JSON.parse(stdout);

    assert.equal(report.quote.mcpServersCount, 1);
    assert.equal(report.summary.failed, 0);
    assert.ok(report.checks.some(check => check.code === "mcp_paid_manifest_present"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI pricing and version commands are available", async () => {
  const pricing = await execFileAsync(process.execPath, [cliPath, "pricing"]);
  const version = await execFileAsync(process.execPath, [cliPath, "version"]);

  assert.match(pricing.stdout, /Probe:\s+\$0\.01 per endpoint check/s);
  assert.match(pricing.stdout, /Standard: \$2\.50 per endpoint/);
  assert.match(version.stdout, /safe402 0\.2\.0/);
  assert.match(version.stdout, /build local/);
});

test("CLI policy init writes default policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "safe402-policy-"));

  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "policy", "init"], { cwd: directory });
    const policy = JSON.parse(await readFile(join(directory, "safe402.policy.json"), "utf8"));

    assert.match(stdout, /Created safe402\.policy\.json/);
    assert.equal(policy.maxPaymentUsd, 0.25);
    assert.equal(policy.dailyBudgetUsd, 10);
    assert.deepEqual(policy.allowedNetworks, ["base", "base-sepolia", "eip155:8453", "eip155:84532"]);
    assert.equal(policy.blockSensitiveMetadata, true);
    assert.equal(policy.duplicateWindowMs, 1800000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI probe supports positional URL, request options, billing, and JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "safe402-probe-cli-"));
  let observedRequest;
  const server = createServer((request, response) => {
    const chunks = [];

    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      observedRequest = {
        method: request.method,
        header: request.headers["x-safe402-test"],
        body
      };

      response.writeHead(402, { "content-type": "application/json" });
      response.end(JSON.stringify({
        accepts: [{
          ...requirement,
          resource: `http://127.0.0.1:${server.address().port}/paid`
        }]
      }));
    });
  });

  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/paid`;
    const policyPath = join(directory, "policy.json");
    const approvalPolicyPath = join(directory, "approval-policy.json");

    await writeFile(policyPath, JSON.stringify({
      maxPaymentUsd: 0.1,
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"]
    }), "utf8");
    await writeFile(approvalPolicyPath, JSON.stringify({
      maxPaymentUsd: 0.1,
      allowedNetworks: ["base-sepolia"],
      allowedAssets: ["USDC"],
      requireApprovalAboveUsd: 0.001
    }), "utf8");

    const billingReceiptPath = join(directory, "billing-receipts.json");
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "probe",
      url,
      "--method",
      "POST",
      "--header",
      "x-safe402-test",
      "yes",
      "--body",
      "{\"hello\":\"world\"}",
      "--policy",
      policyPath,
      "--billing-mode",
      "mock",
      "--json"
    ], {
      env: {
        ...process.env,
        SAFE402_BILLING_RECEIPT_STORE: "file",
        SAFE402_BILLING_RECEIPT_FILE: billingReceiptPath
      }
    });
    const report = JSON.parse(stdout);
    const billingReceipts = JSON.parse(await readFile(billingReceiptPath, "utf8"));

    assert.equal(observedRequest.method, "POST");
    assert.equal(observedRequest.header, "yes");
    assert.equal(observedRequest.body, "{\"hello\":\"world\"}");
    assert.equal(report.pricing.unitPriceUsd, 0.01);
    assert.equal(report.billing.mode, "mock");
    assert.equal(report.billing.paid, true);
    assert.equal(report.billing.kind, "billing_receipt");
    assert.equal(billingReceipts.length, 1);
    assert.equal(billingReceipts[0].product, "probe");
    assert.equal(billingReceipts[0].amountUsd, 0.01);
    assert.equal(report.probes[0].category, "APPROVED");

    await assert.rejects(
      execFileAsync(process.execPath, [
        cliPath,
        "probe",
        url,
        "--policy",
        approvalPolicyPath,
        "--ci",
        "--json"
      ]),
      error => {
        const failedReport = JSON.parse(error.stdout);
        assert.equal(failedReport.probes[0].category, "NEEDS_APPROVAL");
        assert.equal(error.code, 1);
        return true;
      }
    );
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
