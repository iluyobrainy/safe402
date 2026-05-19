import { createMemoryReceiptStore, createSafe402Fetch } from "../src/index.js";

const receipts = createMemoryReceiptStore();

const paidFetch: typeof fetch = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "PAYMENT-RESPONSE": "demo-receipt"
    }
  });
};

const demoFetch: typeof fetch = async () => {
  return new Response(JSON.stringify({
    accepts: [
      {
        scheme: "exact",
        network: "base-sepolia",
        asset: "USDC",
        payTo: "0x0000000000000000000000000000000000000000",
        maxAmountRequired: "0.01",
        resource: "https://api.example.com/paid-data"
      }
    ]
  }), { status: 402 });
};

const safeFetch = createSafe402Fetch({
  fetch: demoFetch,
  paidFetch,
  receipts,
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    allowedDomains: ["api.example.com"],
    allowedNetworks: ["base-sepolia"],
    allowedPayTo: ["0x0000000000000000000000000000000000000000"],
    blockPaymentIntentChanges: true,
    requirePaymentResponseHeader: true,
    duplicateWindowMs: 30 * 60 * 1000
  }
});

const response = await safeFetch("https://api.example.com/paid-data");
const data = await response.json();

console.log(data);
console.log(await receipts.list());
