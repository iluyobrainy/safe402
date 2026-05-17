# Safe402

Safe402 checks x402 payment requests before your agent signs.

It is a preflight probe and audit toolkit for developers building, integrating, or buying x402-powered agents, APIs, and MCP tools. Safe402 helps answer the question that matters before money moves: what is this endpoint asking my agent to pay, and does the payment flow behave safely enough to trust?

```bash
npx safe402 probe https://another-agent.com/paid-tool
```

```bash
npx safe402 audit https://my-agent.com/x402/tool --profile standard
```

## What Safe402 Is

Safe402 is a safety layer for x402 payment flows.

It can:

- inspect an x402 payment challenge before payment
- evaluate every `accepts` option against policy
- detect unsupported chains, unsupported assets, unexpected payees, and amount ambiguity
- scan x402 metadata for PII, API keys, secrets, and sensitive task context
- quote and run deeper audits for retry loops, payment mutation, duplicate payment risk, missing identifiers, and MCP paid-tool issues
- return console, JSON, and Markdown reports for local use and CI

## What Safe402 Is Not

Safe402 is not a wallet, facilitator, or payment marketplace.

It does not custody funds, create wallets, settle payments, replace your facilitator, or guarantee that a provider is honest. Bring your own wallet, x402 client, facilitator, and payment infrastructure. Safe402 checks the payment request and the surrounding flow.

## Core Products

### Probe

Probe checks what an endpoint wants your agent to pay.

`safe402 probe` makes an unpaid request, captures the x402 `402 Payment Required` challenge, parses payment requirements from headers or body, evaluates every `accepts` option, selects the best compatible rail, and reports whether the request matches your policy.

Probe does not sign or send funds.

```bash
safe402 probe https://api.example.com/paid
```

### Audit

Audit stress-tests an x402 payment flow before launch or integration.

Audit includes probe as the first step, then checks failure scenarios such as changed `payTo`, changed amount, changed resource, retry loops, duplicate payment risk, missing `payment-identifier`, missing receipt proof, privacy leaks, facilitator risk, paid-but-denied risk, unpaid-service risk, and MCP paid-tool mismatch.

```bash
safe402 audit https://api.example.com/paid --profile standard
```

## Buyer-Side Usage

A developer can probe or audit another agent or API before paying.

```bash
safe402 probe https://another-agent.com/paid-tool
```

```bash
safe402 audit https://another-agent.com/paid-tool --profile basic
```

Use this when your agent is about to integrate deeply with another paid agent, API, or MCP tool and you want to know what payment data it will ask your wallet to sign.

## Provider-Side Usage

A developer can probe or audit their own endpoint before launch.

```bash
safe402 audit https://my-agent.com/x402/tool --profile standard
```

Use this before shipping a paid endpoint so you can catch unstable payment challenges, unclear prices, metadata leaks, broken receipt headers, or retry behavior that could make buyers afraid to autopay.

## Install

Install the CLI globally:

```bash
npm install --global safe402
```

Or run it directly with `npx`:

```bash
npx safe402 probe https://api.example.com/paid
```

Safe402 expects Node.js 20 or newer.

## Pricing

Probe:

- $0.01 per endpoint check

Audit:

| Profile | Price |
| --- | ---: |
| Basic | $0.50 per endpoint |
| Standard | $2.50 per endpoint |
| Deep | $5.00 per endpoint |
| Custom | quote-based |

Audit starts at $0.50 and increases based on audit scope because endpoint count, request variants, MCP checks, hosted reports, and audit depth can change how much analysis is required.

Audit add-ons currently include:

| Add-on | Price |
| --- | ---: |
| Additional request variant | $0.25 each |
| MCP tool manifest scan | $1.00 per MCP server |
| CI signed hosted report | $1.00 per report |

Show current pricing:

```bash
safe402 pricing
```

## Example Probe Output

```text
Decision: BLOCKED_BY_POLICY
Endpoint requested: $2.00
Your max auto-spend: $0.25
Reason: Price exceeds wallet policy.
Note: This does not mean the provider is malicious.
```

`BLOCKED_BY_POLICY` means the payment does not match your configured policy. It does not mean the endpoint is malicious.

## Example Audit Output

```text
FAIL: payTo changed between challenge requests
WARN: missing payment-identifier
PASS: amount stable
PASS: no PII in metadata
Verdict: NOT_SAFE_TO_AUTOPAY
```

Audit uses stronger language only when there is actual payment-flow risk, such as changed recipient, changed amount, chain mismatch, missing payment response, duplicate payment risk, retry-loop risk, metadata leaks, invalid x402, or paid-but-denied behavior.

Generated JSON and Markdown examples live in `examples/reports/`. Regenerate them with:

```bash
npm run examples:reports
```

## Policy File

Create a default policy:

```bash
safe402 policy init
```

Example `safe402.policy.json`:

```json
{
  "maxPaymentUsd": 0.25,
  "dailyBudgetUsd": 10,
  "allowedDomains": ["api.example.com", "another-agent.com"],
  "allowedNetworks": ["base", "base-sepolia"],
  "allowedAssets": ["USDC"],
  "allowedPayees": ["0x0000000000000000000000000000000000000000"],
  "requireApprovalAboveUsd": 1,
  "blockSensitiveMetadata": true,
  "blockPaymentIntentChanges": true,
  "requirePaymentResponseHeader": true,
  "duplicateWindowMs": 1800000
}
```

Run probe or audit with a policy:

```bash
safe402 probe https://api.example.com/paid --policy safe402.policy.json
```

```bash
safe402 audit https://api.example.com/paid --profile standard --policy safe402.policy.json
```

## Billing Modes

Safe402 supports three billing modes:

```bash
SAFE402_BILLING_MODE=disabled
```

`disabled` shows prices but does not require payment. This is the default for local development and open-source testing.

```bash
SAFE402_BILLING_MODE=mock
```

`mock` simulates payment and creates mock receipts so billing-gated flows can be tested locally.

```bash
SAFE402_BILLING_MODE=x402
```

`x402` is the paid billing mode. Safe402 calculates the exact probe or audit quote, requests payment to the configured Safe402 `payTo`, verifies the payment proof, saves a receipt, and attaches that receipt to the report.

Billing environment variables:

| Variable | Values |
| --- | --- |
| `SAFE402_BILLING_MODE` | `disabled`, `mock`, or `x402` |
| `SAFE402_BILLING_PAY_TO` | Safe402 collection wallet address |
| `SAFE402_BILLING_NETWORK` | `base` or `base-sepolia` |
| `SAFE402_BILLING_ASSET` | `USDC` or a USDC token address |
| `SAFE402_BILLING_FACILITATOR_URL` | Optional facilitator URL |
| `SAFE402_BILLING_RECEIPT_STORE` | `memory` or `file` |
| `SAFE402_BILLING_RECEIPT_FILE` | Defaults to `safe402-receipts.json` |

Do not hardcode private keys or commit env files.

## JSON Output

Probe JSON:

```bash
safe402 probe https://api.example.com/paid --json
```

Audit JSON:

```bash
safe402 audit https://api.example.com/paid --profile standard --json
```

JSON reports include the target, method, selected payment requirement, policy decision, privacy and suspicious findings, pricing, billing receipt when available, and final recommendation.

## CI Usage

Run audit in CI with a standard profile and critical-only failure policy:

```bash
safe402 audit https://api.example.com/paid --profile standard --ci --fail-on critical
```

For stricter CI, use JSON output and fail the job when the audit verdict is `NOT_SAFE_TO_AUTOPAY`, `INVALID_X402`, or `INCONCLUSIVE`:

```bash
safe402 audit https://api.example.com/paid --profile standard --json
```

Probe can also run in CI:

```bash
safe402 probe https://api.example.com/paid --ci --json
```

## Audit Quotes

Audit calculates a quote before checks run:

```bash
safe402 audit quote https://api.example.com/paid --profile standard --json
```

Example quote fields:

```json
{
  "profile": "standard",
  "endpointsCount": 1,
  "requestVariantsCount": 0,
  "mcpScanEnabled": false,
  "hostedReportEnabled": false,
  "totalUsd": 2.5
}
```

If audit discovers extra paid scope during execution, it does not silently overcharge. It returns `ADDITIONAL_PAYMENT_REQUIRED` with the extra checks and amount.

## Runtime Wrapper

Safe402 can also wrap an x402-aware paid fetch client:

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
    maxPaymentUsd: 0.25,
    dailyBudgetUsd: 10,
    allowedNetworks: ["base-sepolia"],
    allowedAssets: ["USDC"],
    blockSensitiveMetadata: true,
    blockPaymentIntentChanges: true,
    requirePaymentResponseHeader: true
  }
});

const response = await safeFetch("https://api.example.com/paid");
```

## Package Exports

```ts
import { createSafe402Fetch } from "safe402";
import { runProbe } from "safe402/probe";
import { runAudit, quoteAudit } from "safe402/audit";
import { createProbeJsonReport, createAuditJsonReport } from "safe402/reports";
import { MockBillingProvider, X402BillingProvider } from "safe402/billing";
import { createSafe402McpTools } from "safe402/mcp";
```

## Security Disclaimer

Safe402 reduces payment-flow risk but does not guarantee a provider is honest, solvent, or safe.

Safe402 does not hold user funds.

Safe402 does not make payment unless configured with an x402 billing/payment client.

Probe does not sign or send funds.

Audit may be unpaid simulation unless configured for sandbox or paid-flow tests.

Safe402 cannot protect flows that bypass it and call raw wallet, signing, or paid-fetch code directly.

## Development

```bash
npm install
npm run build
npm test
npm run publish:check
```

Manual live probing is opt-in only:

```bash
SAFE402_LIVE_URL=https://api.example.com/paid SAFE402_LIVE_CONFIRM=1 npm run test:live:manual
```

## Positioning

x402 handles payment. Safe402 checks whether the payment request and payment flow are safe enough for your agent to sign.
