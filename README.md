# Safe402

Safe402 is a local-first safety layer for agents that pay x402 endpoints.

x402 makes it easy for agents to pay APIs. Safe402 helps developers decide whether the agent should pay before the wallet signs, then records what happened afterward.

Use it as:

- an SDK: `createSafe402Fetch()`
- a preflight CLI: `npx safe402 audit`
- an MCP tool wrapper: `createSafe402McpTools()`

Safe402 is not a wallet, facilitator, custody layer, or agent framework. Bring your existing x402 client and wallet. Safe402 adds policy, receipts, duplicate-payment protection, retry-loop fuses, metadata checks, and audit tooling around it.

## Install

```bash
npm install safe402
```

Safe402 expects Node.js 20 or newer for the CLI and Node-specific helpers.

## Quick Start

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
    allowedNetworks: ["base", "base-sepolia"],
    allowedAssets: ["USDC"],
    blockSensitiveMetadata: true,
    duplicateWindowMs: 30 * 60 * 1000
  }
});

const response = await safeFetch("https://api.example.com/paid-data");
```

## How It Works

1. Your agent calls `safeFetch(url)`.
2. Safe402 makes the initial unpaid request.
3. If the response is not `402 Payment Required`, Safe402 returns the response.
4. If the response is `402`, Safe402 extracts the payment requirement.
5. Safe402 evaluates the requirement against your policy and receipt history.
6. If denied, Safe402 throws `Safe402Error` before payment.
7. If approval is required, Safe402 calls your `onApprovalRequired` callback.
8. If approved, Safe402 calls your existing x402-aware `paidFetch`.
9. If the paid fetch returns another `402`, Safe402 stops the loop and records a failed decision.
10. Safe402 stores a receipt or decision in your configured receipt store.

## What Safe402 Blocks

- payments above your per-call limit
- spend that would exceed the daily budget
- endpoints outside your domain allowlist
- explicitly blocked domains
- unsupported networks or assets
- duplicate payment attempts inside a time window
- paid retry loops where `paidFetch` returns another `402`
- sensitive metadata in payment requirements, when enabled
- payments that require human approval but were not approved

## Policy

Policy is plain TypeScript data that you own.

```ts
const policy = {
  maxPaymentUsd: 0.1,
  dailyBudgetUsd: 5,
  allowedDomains: ["api.example.com"],
  blockedDomains: ["bad.example.com"],
  allowedNetworks: ["base", "base-sepolia"],
  allowedAssets: ["USDC"],
  blockSensitiveMetadata: true,
  requireApprovalAboveUsd: 1,
  duplicateWindowMs: 30 * 60 * 1000
};
```

### Policy Fields

| Field | What it does |
| --- | --- |
| `maxPaymentUsd` | Maximum allowed payment for a single request. |
| `dailyBudgetUsd` | Maximum total paid amount per UTC day, calculated from receipts. |
| `allowedDomains` | Only these domains can be paid. |
| `blockedDomains` | These domains are always blocked. |
| `allowedNetworks` | Only these x402 networks can be used. |
| `allowedAssets` | Only these payment assets can be used. |
| `blockSensitiveMetadata` | Blocks obvious emails, phone numbers, secrets, and sensitive query params in x402 metadata. |
| `requireApprovalAboveUsd` | Calls `onApprovalRequired` for payments above this amount. |
| `duplicateWindowMs` | Blocks repeated payments to the same endpoint/payee/amount inside the window. |
| `assetDecimalsByAsset` | Optional override for atomic amount parsing by asset symbol or address. |
| `defaultAssetDecimals` | Optional fallback decimals for atomic integer amounts. |

## Amount Parsing

x402 payment requirements commonly provide `maxAmountRequired` as an atomic token amount. Safe402 recognizes common USDC cases and parses atomic amounts using 6 decimals.

```ts
// USDC atomic amount
maxAmountRequired: "10000" // parsed as 0.01 USD

// Decimal amount
maxAmountRequired: "0.01" // parsed as 0.01 USD
```

For custom assets, pass `assetDecimalsByAsset` or `defaultAssetDecimals`.

```ts
policy: {
  assetDecimalsByAsset: {
    "MYTOKEN": 18
  }
}
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

### Memory Store

Use this for tests and demos:

```ts
import { createMemoryReceiptStore } from "safe402";

const receipts = createMemoryReceiptStore();
```

### JSON File Store

Use this for local Node agents and CLIs that need receipts to survive restarts:

```ts
import { createJsonFileReceiptStore } from "safe402/node";

const receipts = createJsonFileReceiptStore({
  path: ".safe402/receipts.json"
});
```

### Custom Store

Use your own database in production:

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

If the callback returns `false` or is not provided, Safe402 blocks payment before the wallet signs.

## Handling Denied Payments

```ts
import { Safe402Error } from "safe402";

try {
  const response = await safeFetch("https://api.example.com/paid-data");
} catch (error) {
  if (error instanceof Safe402Error) {
    console.log(error.decision.status);
    console.log(error.decision.reason);
  }
}
```

## Preflight Audit CLI

Run the built-in safety checks:

```bash
npx safe402 audit
```

Example output:

```text
Safe402 audit
Checks: 9 passed, 0 failed, 0 warnings

[pass] allows a normal x402 payment - Payment passed Safe402 policy.
[pass] blocks payment above per-call limit - Payment 0.25 exceeds per-call limit 0.1.
[pass] blocks disallowed payment domain - Domain unknown.safe402.test is not in the allowed domain list.
```

The audit currently checks:

- normal payment approval
- per-call limit blocking
- domain allowlist blocking
- network blocking
- approval threshold behavior
- daily budget blocking
- duplicate payment replay blocking
- sensitive metadata blocking
- repeated `402` retry-loop fuse

The command exits with code `1` if any check fails, so it can run in CI.

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
    "blockSensitiveMetadata": true
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

## MCP Tool Wrapper

Safe402 includes dependency-free MCP-style tool handlers that you can register in your MCP server or agent runtime.

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

const decision = await tools.safe402_check_payment.handler({
  url: "https://api.example.com/paid-data",
  requirement: {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    payTo: "0x0000000000000000000000000000000000000000",
    maxAmountRequired: "10000",
    resource: "https://api.example.com/paid-data"
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
npm pack --dry-run
npm run site:build
```

## Production Notes

Safe402 helps enforce payment policy, but it cannot protect code paths that bypass Safe402 and call a raw paid fetch directly.

Safe402 does not:

- create wallets
- custody funds
- settle payments
- guarantee vendor quality
- guarantee fraud prevention
- guarantee that a paid API returns useful data

Use Safe402 as the guardrail around x402 payment calls, then combine it with your existing wallet security, logging, monitoring, and user approval flows.

## Positioning

Safe402 is the safety wrapper developers add before an agent spends money.

x402 handles payment. Safe402 handles whether the agent should pay.
