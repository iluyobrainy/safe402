import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  Safe402Error,
  createSafe402Audit,
  createMemoryReceiptStore,
  createPaymentIntentFingerprint,
  createSafe402Probe,
  createSafe402Fetch,
  defaultPolicy,
  evaluatePayment,
  findSensitivePaymentMetadata,
  loadPolicy,
  parseRequirementAmount
} from "../dist/index.js";
import { runSafe402Audit } from "../dist/audit.js";
import { formatProbeMarkdownReport, runProbe } from "../dist/probe/index.js";
import { createSafe402McpTools } from "../dist/mcp.js";
import { createJsonFileReceiptStore } from "../dist/node.js";

const execFileAsync = promisify(execFile);

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
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 0);
  assert.ok(report.summary.passed >= 14);
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
  assert.equal(audit.quote().estimatedPayments, 0);
  assert.equal((await probe.run()).summary.failed, 0);
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

test("CLI help exits successfully", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "--help"]);

  assert.match(stdout, /safe402 audit/);
  assert.match(stdout, /safe402 probe/);
});

test("CLI audit JSON output is machine-readable", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "audit", "--json"]);
  const report = JSON.parse(stdout);

  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.passed >= 14);
});
