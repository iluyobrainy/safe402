# Safe402

Safe402 makes x402 payments shippable.

It is a local-first audit and runtime safety kit for developers building x402-powered agents, APIs, MCP tools, and payment flows. It is not a payment proxy, facilitator, hosted spend dashboard, wallet, or marketplace.

Use Safe402 before launch to test whether an x402 implementation is safe, private, reliable, and production-ready. Use it at runtime as a fuse around paid fetch calls.

```bash
npx safe402 audit
```

```ts
const safeFetch = createSafe402Fetch({
  paidFetch,
  policy,
  receipts
});
```

## What Safe402 Is

Safe402 is the preflight and runtime safety layer for x402 agent payments.

It helps developers catch:

- 402 retry loops
- duplicate payments
- wrong chain, asset, domain, or recipient
- overpricing attacks
- changed payment intent
- mutated retry bodies
- paid-but-denied responses
- missing `PAYMENT-RESPONSE` headers
- PII or secrets in payment metadata
- broken MCP paid-tool flows
- mismatches between what was paid for and what was delivered

## What Safe402 Is Not

Safe402 does not try to replace x402 infrastructure.

It is not:

- a payment proxy
- a facilitator
- a wallet
- a custody layer
- a hosted spend dashboard
- a marketplace
- an agent framework
- an x402 platform competitor

Bring your existing wallet, facilitator, x402 client, or platform. Safe402 wraps the dangerous edges around the flow.

## Install

Install from GitHub today:

```bash
npm install github:iluyobrainy/safe402
```

After the first npm registry publish:

```bash
npm install safe402
```

Safe402 expects Node.js 20 or newer for the CLI and Node-specific helpers.

## Preflight Audit CLI

Run the built-in safety checks:

```bash
npx safe402 audit
```

Example output:

```text
Safe402 audit
Checks: 14 passed, 0 failed, 0 warnings

[pass] stops paid 402 retry loops - Paid fetch returned another 402; retry fuse stopped to avoid a payment loop.
[pass] blocks changed recipient address - Payee 0x1111...1111 is not allowed.
[pass] blocks mutated retry body - Request intent changed between the 402 challenge and paid retry.
[pass] blocks missing PAYMENT-RESPONSE header - Paid response is missing PAYMENT-RESPONSE header.
[pass] blocks paid-but-denied responses - Paid response returned 403; possible paid-but-denied flow.
[pass] fingerprints payment intent - Different request bodies produce different payment intent fingerprints.
```

The audit prints pass, fail, warning, reason, and fix guidance. It exits with code `1` when checks fail, so it can run in CI.

### Audit a Live Endpoint

This performs an unpaid preflight request. It does not sign or pay.

```bash
npx safe402 audit --url https://api.example.com/paid-data
```

### Audit With Config

```bash
npx safe402 audit --config safe402.config.json
```

Example config:

```json
{
  "policy": {
    "maxPaymentUsd": 0.1,
    "dailyBudgetUsd": 5,
    "allowedDomains": ["api.example.com"],
    "allowedNetworks": ["base-sepolia"],
    "allowedAssets": ["USDC"],
    "allowedPayTo": ["0x0000000000000000000000000000000000000000"],
    "blockSensitiveMetadata": true,
    "blockPaymentIntentChanges": true,
    "requirePaymentResponseHeader": true
  },
  "cases": [
    {
      "name": "example endpoint should pass policy",
      "url": "https://api.example.com/paid-data",
      "expect": "approved",
      "requirement": {
        "scheme": "exact",
        "network": "base-sepolia",
        "asset": "USDC",
        "payTo": "0x0000000000000000000000000000000000000000",
        "maxAmountRequired": "10000",
        "resource": "https://api.example.com/paid-data"
      }
    }
  ]
}
```

Machine-readable output:

```bash
npx safe402 audit --json
```

## Demo Agent

Safe402 includes a local demo agent that tries both safe and unsafe x402 payment flows.

```bash
git clone https://github.com/iluyobrainy/safe402.git
cd safe402
npm install
npm run demo:agent
```

The demo agent simulates:

- a free resource
- a valid paid resource
- a duplicate replay
- an overpriced tool
- a changed recipient address
- leaked metadata
- a repeated `402` retry loop
- a paid response without `PAYMENT-RESPONSE`
- a paid-but-denied `403` response

Expected result:

```text
Safe402 demo agent result

Free resource             allowed
Good paid resource        paid
Duplicate replay          blocked
Overpriced tool           blocked
Wrong recipient           blocked
Metadata leak             blocked
Retry loop                blocked
Missing receipt header    blocked
Paid but denied           blocked
```

## Runtime Safety Wrapper

Use `createSafe402Fetch()` where your agent would normally call an x402-aware paid fetch.

```ts
import { createMemoryReceiptStore, createSafe402Fetch } from "safe402";
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
    allowedNetworks: ["base-sepolia"],
    allowedAssets: ["USDC"],
    allowedPayTo: ["0x0000000000000000000000000000000000000000"],
    blockSensitiveMetadata: true,
    blockPaymentIntentChanges: true,
    requirePaymentResponseHeader: true,
    duplicateWindowMs: 30 * 60 * 1000
  }
});

const response = await safeFetch("https://api.example.com/paid-data");
```

## Runtime Flow

1. Your agent calls `safeFetch(url)`.
2. Safe402 records the request intent fingerprint.
3. Safe402 makes the initial unpaid request.
4. If the response is not `402 Payment Required`, Safe402 returns it.
5. If the response is `402`, Safe402 extracts the payment requirement.
6. Safe402 checks amount, domain, network, asset, payee, metadata, budget, receipts, and duplicate history.
7. If approval is required, Safe402 calls your `onApprovalRequired` callback.
8. Before payment, Safe402 checks whether the request intent changed.
9. If allowed, Safe402 calls your existing x402 `paidFetch`.
10. Safe402 fails repeated `402`, missing payment receipt headers, and paid-but-denied responses.
11. Safe402 records the decision and receipt in your configured store.

## Policy Fields

| Field | What it does |
| --- | --- |
| `maxPaymentUsd` | Maximum allowed payment for a single request. |
| `dailyBudgetUsd` | Maximum total paid amount per UTC day, calculated from receipts. |
| `allowedDomains` | Only these domains can be paid. |
| `blockedDomains` | These domains are always blocked. |
| `allowedNetworks` | Only these x402 networks can be used. |
| `allowedAssets` | Only these payment assets can be used. |
| `allowedPayTo` | Only these recipient addresses can be paid. |
| `blockSensitiveMetadata` | Blocks obvious emails, phone numbers, secrets, and sensitive query params in x402 metadata. |
| `blockPaymentIntentChanges` | Blocks request mutation between the 402 challenge and the paid retry. |
| `requirePaymentResponseHeader` | Requires a `PAYMENT-RESPONSE` or `X-PAYMENT-RESPONSE` header after payment. |
| `failOnPaidStatusCodes` | Treats configured paid response status codes as failed paid-but-denied flows. Defaults to `401` and `403`. |
| `requireApprovalAboveUsd` | Calls `onApprovalRequired` for payments above this amount. |
| `duplicateWindowMs` | Blocks repeated payments to the same endpoint, payee, and amount inside the window. |
| `assetDecimalsByAsset` | Optional override for atomic amount parsing by asset symbol or address. |
| `defaultAssetDecimals` | Optional fallback decimals for atomic integer amounts. |

## Payment Intent Fingerprints

Safe402 fingerprints the intent around a payment:

- method
- URL without hash
- request body summary
- payee
- network
- asset
- amount
- resource
- description
- MIME type

This helps detect mutated retry bodies and changed payment requirements.

```ts
import { createPaymentIntentFingerprint } from "safe402";

const fingerprint = createPaymentIntentFingerprint({
  input: "https://api.example.com/paid-data",
  init: { method: "POST", body: "task=a" },
  requirement
});
```

## Receipts

Safe402 stores every decision through a receipt store.

```ts
type Safe402ReceiptStore = {
  list(): Promise<Safe402Receipt[]>;
  save(receipt: Safe402Receipt): Promise<void>;
};
```

Receipts power:

- daily budget calculation
- duplicate-payment blocking
- audit history
- debugging
- user-visible payment history
- payment intent tracing

### Memory Store

```ts
import { createMemoryReceiptStore } from "safe402";

const receipts = createMemoryReceiptStore();
```

### JSON File Store

```ts
import { createJsonFileReceiptStore } from "safe402/node";

const receipts = createJsonFileReceiptStore({
  path: ".safe402/receipts.json"
});
```

### Custom Store

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

## MCP Tool Wrapper

Safe402 includes dependency-light MCP-style tool handlers that you can register in your MCP server or agent runtime.

```ts
import { createMemoryReceiptStore } from "safe402";
import { createSafe402McpTools } from "safe402/mcp";

const tools = createSafe402McpTools({
  receipts: createMemoryReceiptStore(),
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    allowedDomains: ["api.example.com"],
    allowedNetworks: ["base-sepolia"],
    allowedAssets: ["USDC"]
  }
});
```

Available tools:

| Tool | Purpose |
| --- | --- |
| `safe402_check_payment` | Evaluate an x402 payment requirement against policy before paying. |
| `safe402_pay_resource` | Fetch an x402-protected resource through Safe402 policy checks. |
| `safe402_get_receipts` | Return payment decisions and receipts from the configured store. |
| `safe402_get_budget` | Return today's spend and remaining daily budget. |

## Package Exports

```ts
import { createSafe402Fetch } from "safe402";
import { createPaymentIntentFingerprint } from "safe402";
import { runSafe402Audit } from "safe402/audit";
import { createSafe402McpTools } from "safe402/mcp";
import { createJsonFileReceiptStore } from "safe402/node";
```

## Examples

- `examples/basic.ts`
- `examples/mcp-tools.ts`
- `examples/json-file-receipts.ts`
- `safe402.config.example.json`

## Documentation Website

The production documentation website lives in `website/`.

```bash
npm --prefix website install
npm run site:dev
npm run site:build
```

## Development

```bash
npm install
npm run check
npm test
npm run audit
npm run demo:agent
npm pack --dry-run
npm run site:build
```

## Production Notes

Safe402 helps test and enforce x402 payment safety, but it cannot protect code paths that bypass Safe402 and call raw payment functions directly.

Safe402 does not:

- create wallets
- custody funds
- settle payments
- guarantee vendor quality
- guarantee fraud prevention
- guarantee that a paid API returns useful data

Use Safe402 as the audit and runtime fuse around x402 payment calls, then combine it with your existing wallet security, logging, monitoring, and user approval flows.

## Positioning

Safe402 makes x402 payments shippable.

x402 handles payment. Safe402 handles whether the flow is safe enough to ship.
