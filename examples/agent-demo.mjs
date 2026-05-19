import { createMemoryReceiptStore, createSafe402Fetch, Safe402Error } from "../dist/index.js";

const GOOD_PAY_TO = "0x0000000000000000000000000000000000000000";
const BAD_PAY_TO = "0x1111111111111111111111111111111111111111";

const scenarios = [
  {
    id: "free_resource",
    label: "Free resource",
    expected: "allowed",
    challenge: null,
    paid: { status: 200, body: { ok: true, source: "free" }, headers: {} }
  },
  {
    id: "good_paid_resource",
    label: "Good paid resource",
    expected: "paid",
    challenge: requirement({ maxAmountRequired: "10000" }),
    paid: { status: 200, body: { ok: true, source: "paid research" }, headers: { "PAYMENT-RESPONSE": "demo-receipt" } }
  },
  {
    id: "duplicate_replay",
    path: "good_paid_resource",
    label: "Duplicate replay",
    expected: "blocked",
    challenge: requirement({ resource: "https://api.agent-demo.test/good_paid_resource", maxAmountRequired: "10000" }),
    paid: { status: 200, body: { ok: true }, headers: { "PAYMENT-RESPONSE": "demo-receipt" } }
  },
  {
    id: "overpriced_tool",
    label: "Overpriced tool",
    expected: "blocked",
    challenge: requirement({ maxAmountRequired: "250000" }),
    paid: { status: 200, body: { ok: true }, headers: { "PAYMENT-RESPONSE": "demo-receipt" } }
  },
  {
    id: "wrong_payee",
    label: "Wrong recipient",
    expected: "blocked",
    challenge: requirement({ payTo: BAD_PAY_TO }),
    paid: { status: 200, body: { ok: true }, headers: { "PAYMENT-RESPONSE": "demo-receipt" } }
  },
  {
    id: "metadata_leak",
    label: "Metadata leak",
    expected: "blocked",
    challenge: requirement({
      resource: "https://api.agent-demo.test/metadata_leak?api_key=sk-test-secret",
      description: "research for ada@example.com"
    }),
    paid: { status: 200, body: { ok: true }, headers: { "PAYMENT-RESPONSE": "demo-receipt" } }
  },
  {
    id: "retry_loop",
    label: "Retry loop",
    expected: "blocked",
    challenge: requirement({}),
    paid: { status: 402, body: { error: "still requires payment" }, headers: {} }
  },
  {
    id: "missing_receipt",
    label: "Missing receipt header",
    expected: "blocked",
    challenge: requirement({}),
    paid: { status: 200, body: { ok: true }, headers: {} }
  },
  {
    id: "paid_but_denied",
    label: "Paid but denied",
    expected: "blocked",
    challenge: requirement({}),
    paid: { status: 403, body: { error: "forbidden after payment" }, headers: { "PAYMENT-RESPONSE": "demo-receipt" } }
  }
];

class DemoAgent {
  constructor() {
    this.receipts = createMemoryReceiptStore();
  }

  async runScenario(scenario) {
    const safeFetch = createSafe402Fetch({
      fetch: async () => {
        if (!scenario.challenge) {
          return jsonResponse(scenario.paid.status, scenario.paid.body, scenario.paid.headers);
        }

        return jsonResponse(402, { accepts: [scenario.challenge] });
      },
      paidFetch: async () => jsonResponse(scenario.paid.status, scenario.paid.body, scenario.paid.headers),
      receipts: this.receipts,
      policy: {
        maxPaymentUsd: 0.1,
        dailyBudgetUsd: 1,
        allowedDomains: ["api.agent-demo.test"],
        allowedNetworks: ["base-sepolia"],
        allowedAssets: ["USDC"],
        allowedPayTo: [GOOD_PAY_TO],
        blockSensitiveMetadata: true,
        blockPaymentIntentChanges: true,
        requirePaymentResponseHeader: true,
        duplicateWindowMs: 30 * 60 * 1000
      }
    });

    try {
      const response = await safeFetch(`https://api.agent-demo.test/${scenario.path ?? scenario.id}`);
      return {
        scenario: scenario.label,
        expected: scenario.expected,
        result: response.status === 200 && scenario.challenge ? "paid" : "allowed",
        reason: response.status === 200 ? "Safe402 allowed the flow." : `HTTP ${response.status}`
      };
    } catch (error) {
      if (error instanceof Safe402Error) {
        return {
          scenario: scenario.label,
          expected: scenario.expected,
          result: "blocked",
          reason: error.decision.reason
        };
      }

      throw error;
    }
  }
}

const agent = new DemoAgent();
const results = [];

for (const scenario of scenarios) {
  results.push(await agent.runScenario(scenario));
}

console.log("\nSafe402 demo agent result\n");
console.table(results);
console.log("\nReceipts saved by Safe402:");
console.table((await agent.receipts.list()).map(receipt => ({
  status: receipt.status,
  amountUsd: receipt.amountUsd,
  domain: receipt.domain,
  responseStatus: receipt.responseStatus ?? "",
  reason: receipt.reason
})));

function requirement(overrides) {
  return {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    payTo: GOOD_PAY_TO,
    maxAmountRequired: "10000",
    resource: "https://api.agent-demo.test/paid-resource",
    ...overrides
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}
