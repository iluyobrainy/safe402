# Safe402

Safe402 is a spending firewall for agents that pay x402 endpoints.

Agents can already pay APIs with x402. Safe402 helps developers decide whether an agent should pay before the wallet signs: price limits, domain allowlists, duplicate-payment blocking, retry safety, approval hooks, and receipts.

```ts
import { createSafe402Fetch, createMemoryReceiptStore } from "safe402";
import { wrapFetchWithPayment } from "@x402/fetch";

const paidFetch = wrapFetchWithPayment(fetch, x402Client);

const safeFetch = createSafe402Fetch({
  fetch,
  paidFetch,
  receipts: createMemoryReceiptStore(),
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    allowedNetworks: ["base", "base-sepolia"],
    allowedDomains: ["api.example.com"],
    duplicateWindowMs: 30 * 60 * 1000
  }
});

const response = await safeFetch("https://api.example.com/paid-data");
```

## Why this exists

x402 makes payment easy for agents. That creates a new question:

> How do I let my agent pay useful APIs without giving it a blank check?

Safe402 is the tiny layer that sits before payment.

## What Safe402 blocks

- payments above your per-call limit
- spend that exceeds the daily budget
- endpoints outside your allowlist
- unsupported networks or assets
- duplicate payment attempts within a time window
- paid retry loops
- payments that need human approval first

## MVP API

```ts
const safeFetch = createSafe402Fetch({
  fetch,
  paidFetch,
  policy,
  receipts,
  onDecision: decision => {
    console.log(decision.status, decision.reason);
  },
  onApprovalRequired: async decision => {
    return decision.amountUsd <= 1;
  }
});
```

Safe402 intentionally wraps the official x402 ecosystem instead of replacing it. You can keep using `@x402/fetch`, Coinbase CDP, Cloudflare Agents, or your own x402 client.

## Roadmap

- TypeScript SDK
- local receipt store
- hosted receipt API
- MCP tool wrapper
- vendor reputation checks
- dashboard for spend, blocked payments, and exportable receipts

## Positioning

Safe402 is not a wallet and not an agent platform.

It is the safety wrapper developers add before an agent spends money.

## Docs

- [SDK usage](./docs/SDK_USAGE.md)
- [Competitive notes](./docs/COMPETITIVE_NOTES.md)
