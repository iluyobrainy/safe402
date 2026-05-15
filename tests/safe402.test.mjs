import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  Safe402Error,
  createMemoryReceiptStore,
  createSafe402Fetch,
  evaluatePayment,
  findSensitivePaymentMetadata,
  parseRequirementAmount
} from "../dist/index.js";
import { runSafe402Audit } from "../dist/audit.js";
import { createSafe402McpTools } from "../dist/mcp.js";
import { createJsonFileReceiptStore } from "../dist/node.js";

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

test("audit passes built-in checks", async () => {
  const report = await runSafe402Audit();

  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.warnings, 0);
  assert.ok(report.summary.passed >= 9);
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
