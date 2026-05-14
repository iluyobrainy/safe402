# Safe402 SDK Usage

Safe402 is a local-first SDK for agents that pay x402 endpoints.

It does not replace x402, a wallet, or a facilitator. It sits before the paid request and answers one question:

> Should this agent be allowed to pay this x402 requirement right now?

## The Mental Model

Without Safe402:

```ts
const response = await paidFetch("https://api.example.com/paid-data");
```

The x402 client handles the 402 challenge, signs payment, retries, and returns the paid resource.

With Safe402:

```ts
const response = await safeFetch("https://api.example.com/paid-data");
```

Safe402 first inspects the `402 Payment Required` response, checks your policy, records the decision, then calls your existing paid x402 fetch only if the payment is allowed.

## What Runs Where

Safe402 runs inside the developer's app, agent, worker, CLI, or MCP server.

By default, nothing is sent to Safe402 servers because there are no Safe402 servers in V1.

The developer controls:

- the wallet
- the x402 client
- the payment fetch function
- the policy object
- the receipt store
- the approval flow
- the logs

Safe402 only enforces the rules passed into it.

## Payment Flow

1. The agent calls `safeFetch(url)`.
2. Safe402 makes a normal unpaid request with `fetch`.
3. If the response is not `402`, Safe402 returns it and records a free decision.
4. If the response is `402`, Safe402 extracts the payment requirement.
5. Safe402 evaluates the payment requirement against policy.
6. If denied, Safe402 throws `Safe402Error` before payment.
7. If approval is required, Safe402 calls `onApprovalRequired`.
8. If approved, Safe402 calls the developer's `paidFetch`.
9. The x402 client signs, pays, retries, and returns the paid response.
10. Safe402 records the final paid receipt.

## Basic Setup

```ts
import { createSafe402Fetch, createMemoryReceiptStore } from "safe402";
import { wrapFetchWithPayment } from "@x402/fetch";

const paidFetch = wrapFetchWithPayment(fetch, x402Client);
const receipts = createMemoryReceiptStore();

const safeFetch = createSafe402Fetch({
  fetch,
  paidFetch,
  receipts,
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    allowedDomains: ["api.example.com"],
    allowedNetworks: ["base", "base-sepolia"],
    allowedAssets: ["USDC"],
    duplicateWindowMs: 30 * 60 * 1000
  }
});

const response = await safeFetch("https://api.example.com/paid-data");
```

## What `paidFetch` Is

`paidFetch` is the developer's existing x402-aware fetch function.

Safe402 does not create or manage wallets. That should stay with the x402 ecosystem or the developer's chosen wallet provider.

Examples of `paidFetch` sources:

- `@x402/fetch`
- Cloudflare Agents x402 client
- a custom x402 client
- a test double in local development

Safe402 calls `paidFetch` only after policy passes.

## Policy

Policy is plain TypeScript data owned by the developer.

```ts
const policy = {
  maxPaymentUsd: 0.1,
  dailyBudgetUsd: 5,
  allowedDomains: ["api.example.com"],
  blockedDomains: ["unknown-expensive-api.example"],
  allowedNetworks: ["base", "base-sepolia"],
  allowedAssets: ["USDC"],
  requireApprovalAboveUsd: 1,
  duplicateWindowMs: 30 * 60 * 1000
};
```

### `maxPaymentUsd`

Maximum allowed payment for one request.

Use this to stop accidental expensive calls.

### `dailyBudgetUsd`

Maximum total paid amount per UTC day, based on receipts in the configured receipt store.

Use this to stop runaway loops and unexpected spend.

### `allowedDomains`

Only these domains may be paid.

Use this when your agent should pay known vendors only.

### `blockedDomains`

These domains are always blocked.

Use this for denylisted vendors or internal endpoints.

### `allowedNetworks`

Only these x402 networks may be used.

Example:

```ts
allowedNetworks: ["base", "base-sepolia"]
```

### `allowedAssets`

Only these assets may be used.

Example:

```ts
allowedAssets: ["USDC"]
```

### `requireApprovalAboveUsd`

Payments above this amount trigger `onApprovalRequired`.

This lets developers put a human or another policy service in the loop.

### `duplicateWindowMs`

Blocks repeated payments to the same origin/path/network/asset/payee/amount inside the time window.

Use this to stop retry loops and duplicate paid calls.

## Receipts

Receipts are stored through a simple interface.

```ts
type Safe402ReceiptStore = {
  list(): Promise<Safe402Receipt[]>;
  save(receipt: Safe402Receipt): Promise<void>;
};
```

V1 includes an in-memory store:

```ts
const receipts = createMemoryReceiptStore();
```

This is useful for demos and tests. Production apps should provide their own store.

## Custom Receipt Store

A developer can store receipts in Postgres, Redis, SQLite, Supabase, a file, or their existing observability pipeline.

```ts
const receipts = {
  async list() {
    return db.receipts.findMany({ where: { agentId: "research-agent" } });
  },
  async save(receipt) {
    await db.receipts.create({
      data: {
        agentId: "research-agent",
        ...receipt
      }
    });
  }
};
```

Safe402 uses receipts for:

- daily budget calculation
- duplicate payment blocking
- audit history
- debugging
- user-visible payment history

## Receipt Shape

```ts
{
  status: "paid",
  reason: "Payment passed Safe402 policy and paid fetch completed.",
  url: "https://api.example.com/paid-data",
  domain: "api.example.com",
  amountUsd: 0.01,
  requirement: {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    payTo: "0x...",
    maxAmountRequired: "0.01"
  },
  duplicateKey: "https://api.example.com|/paid-data|base-sepolia|USDC|0x...|0.01",
  timestamp: "2026-05-14T20:08:58.346Z",
  responseStatus: 200,
  paymentResponse: "..."
}
```

## Human Approval

```ts
const safeFetch = createSafe402Fetch({
  paidFetch,
  receipts,
  policy: {
    requireApprovalAboveUsd: 1
  },
  onApprovalRequired: async decision => {
    await notifyUser(decision);
    return await waitForUserApproval(decision);
  }
});
```

If the callback returns `false`, Safe402 blocks payment before the wallet signs.

## Handling Blocked Payments

```ts
import { Safe402Error } from "safe402";

try {
  const response = await safeFetch("https://unknown.example.com/paid");
} catch (error) {
  if (error instanceof Safe402Error) {
    console.log(error.decision.status);
    console.log(error.decision.reason);
  }
}
```

## MCP Wrapper Direction

The MCP wrapper should expose Safe402 as agent-callable tools:

- `safe402_check_payment`
- `safe402_pay_resource`
- `safe402_get_receipts`
- `safe402_get_budget`

The wrapper should still use the same SDK core and receipt store interface.

That keeps the product small:

- SDK for developers writing agent code
- MCP wrapper for agent environments that prefer tools
- hosted API/dashboard only after usage proves the need

## What Developers Should Expect

Safe402 should provide:

- predictable policy decisions before payment
- local-first receipt storage
- clear errors when payments are blocked
- compatibility with existing x402 clients
- a small API surface
- no hosted dependency in the default path

Safe402 should not promise:

- custody
- wallet creation
- settlement
- fraud guarantees
- API quality guarantees
- vendor reputation in V1
- protection if the developer bypasses Safe402 and calls `paidFetch` directly

## Why This Is Important

x402 makes payment frictionless. For agents, frictionless payment is powerful but dangerous.

The missing layer is not only "how to pay." It is:

- should this agent pay?
- how much can it spend?
- which vendors can it pay?
- has it already paid this endpoint?
- where is the receipt?
- how do I debug what happened?
- how do I explain the spend to a user or team?

Safe402 exists to make those answers easy.

