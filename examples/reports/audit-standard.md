# Safe402 Audit Report

- Report type: `audit`
- Generated: `2026-05-17T00:00:00.000Z`
- Target: built-in audit fixture
- Profile: `standard`
- Final verdict: `SAFE_TO_PAY`
- CI status: `pass`
- Recommendation: This x402 payment flow behaves safely under the audited failure conditions.

## Quote

- Total: $2.50
- Endpoints: `0`
- Request variants: `0`
- MCP scan: `false`

## Test Matrix

| Category | Total | Passed | Warnings | Failed | Critical |
| --- | ---: | ---: | ---: | ---: | ---: |
| challenge | 8 | 8 | 0 | 0 | 0 |
| duplicate | 2 | 2 | 0 | 0 | 0 |
| idempotency | 3 | 3 | 0 | 0 | 0 |
| payment_intent | 4 | 4 | 0 | 0 | 0 |
| policy | 8 | 8 | 0 | 0 | 0 |
| privacy | 5 | 5 | 0 | 0 | 0 |
| retry | 8 | 8 | 0 | 0 | 0 |
| stability | 4 | 4 | 0 | 0 | 0 |

## Checks

| ID | Severity | Status | Title | Explanation | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `VALID_402_CHALLENGE` | `PASS` | `pass` | valid 402 challenge structure | The x402 challenge includes the core payment fields needed for policy evaluation. |  |
| `ACCEPTS_OPTIONS_PARSED` | `INFO` | `pass` | multiple accepts handling | The challenge exposes one payment option. |  |
| `HUMAN_MACHINE_PRICE_MATCH` | `PASS` | `pass` | human price matches machine amount | No human-readable price mismatch was detected. |  |
| `ASSET_DECIMALS_RESOLVED` | `PASS` | `pass` | asset decimals ambiguity | Asset decimals resolved to 6. |  |
| `HUMAN_PRICE_PRESENT` | `PASS` | `pass` | clear human-readable price | The challenge includes a human-readable price. |  |
| `CHAIN_ALLOWED` | `PASS` | `pass` | supported payment chain | Network base-sepolia is acceptable for this audit policy. |  |
| `ASSET_ALLOWED` | `PASS` | `pass` | supported payment asset | Asset USDC is acceptable for this audit policy. |  |
| `PAYTO_PRESENT` | `PASS` | `pass` | expected payTo recipient | payTo matches the audit policy allowlist. |  |
| `NO_PII_IN_METADATA` | `PASS` | `pass` | PII in description | Description metadata did not expose PII. |  |
| `NO_PII_IN_METADATA` | `PASS` | `pass` | PII in resource URL | Resource URL did not expose sensitive query parameters or PII. |  |
| `NO_PII_IN_METADATA` | `PASS` | `pass` | PII in reason strings | Reason strings did not expose PII. |  |
| `NO_PII_IN_METADATA` | `PASS` | `pass` | API keys in metadata | Payment metadata did not expose API keys or bearer tokens. |  |
| `NO_PII_IN_METADATA` | `PASS` | `pass` | wallet-linked sensitive metadata | Metadata did not link wallet identity to sensitive context. |  |
| `EXPECTED_APPROVED` | `PASS` | `pass` | policy decision allows a normal x402 payment | Payment passed Safe402 policy. |  |
| `EXPECTED_DENIED` | `PASS` | `pass` | policy decision blocks payment above per-call limit | Payment 0.25 exceeds per-call limit 0.1. |  |
| `EXPECTED_DENIED` | `PASS` | `pass` | policy decision blocks disallowed payment domain | Domain unknown.safe402.test is not in the allowed domain list. |  |
| `EXPECTED_DENIED` | `PASS` | `pass` | policy decision blocks unsupported payment network | Network base is not allowed. |  |
| `EXPECTED_DENIED` | `PASS` | `pass` | policy decision blocks unsupported payment asset | Asset DAI is not allowed. |  |
| `EXPECTED_DENIED` | `PASS` | `pass` | policy decision blocks unexpected payTo | Payee 0x1111111111111111111111111111111111111111 is not allowed. |  |
| `EXPECTED_APPROVAL_REQUIRED` | `PASS` | `pass` | policy decision requires approval above threshold | Payment requires human approval. |  |
| `EXPECTED_DENIED` | `PASS` | `pass` | policy decision blocks payment that exceeds daily budget | Payment would exceed daily budget 0.15. |  |
| `PAYMENT_IDENTIFIER_PRESENT` | `PASS` | `pass` | payment-identifier support | Payment requirement includes a payment identifier. |  |
| `IDEMPOTENCY_PRESENT` | `PASS` | `pass` | idempotency support | Payment requirement includes an idempotency key. |  |
| `IDENTIFIER_BINDING_PRESENT` | `PASS` | `pass` | missing idempotency or payment-identifier support | At least one identifier is available for retry reconciliation. |  |
| `PAYMENT_INTENT_STABLE` | `PASS` | `pass` | payment intent fingerprint stability | Payment intent fingerprint covers method, URL, body hash, amount, network, asset, and payTo. |  |
| `PAYMENT_INTENT_STABLE` | `INFO` | `pass` | agentTaskId intent binding | agentTaskId was not present; this is optional but useful for deeper agent payment attribution. | Include agentTaskId for agent-initiated paid actions when available. |
| `PAYMENT_INTENT_STABLE` | `PASS` | `pass` | method and body mutation risk | Changing the request body changes the payment intent fingerprint. |  |
| `PAYMENT_INTENT_STABLE` | `PASS` | `pass` | method and body mutation risk runtime block | Request intent changed between the 402 challenge and paid retry. |  |
| `DUPLICATE_PAYMENT_RISK` | `PASS` | `pass` | duplicate retry risk | A repeated payment attempt for the same intent was blocked by duplicate detection. |  |
| `PAYMENT_IDENTIFIER_PRESENT` | `PASS` | `pass` | payment identifier duplicate binding | The requirement includes a payment identifier or idempotency key that can bind duplicate retries. |  |
| `PAYTO_STABLE` | `PASS` | `pass` | payTo changed across repeated challenges | payTo remained stable across repeated challenge requests. |  |
| `AMOUNT_STABLE` | `PASS` | `pass` | amount changed across repeated challenges | amount remained stable across repeated challenge requests. |  |
| `RESOURCE_STABLE` | `PASS` | `pass` | resource changed across repeated challenges | resource remained stable across repeated challenge requests. |  |
| `CHALLENGE_REPEAT_STABLE` | `PASS` | `pass` | repeated challenge stability | Repeated challenge requests returned parseable x402 requirements. |  |
| `RETRY_LOOP_RISK` | `PASS` | `pass` | retry loop risk: repeated 402s | Paid fetch returned another 402 and Safe402 stopped instead of retrying payment. |  |
| `RETRY_LOOP_RISK` | `PASS` | `pass` | retry loop risk: permanent error retried | A permanent paid-response error did not trigger repeated paid retries. |  |
| `RETRY_LOOP_RISK` | `PASS` | `pass` | retry loop risk: chain mismatch retried | Unsupported chain was denied before any paid retry. |  |
| `RETRY_LOOP_RISK` | `PASS` | `pass` | retry loop risk: expired challenge retried | Expired challenge was denied before paid retry. |  |
| `RETRY_LOOP_RISK` | `PASS` | `pass` | retry loop risk: facilitator downtime retried | Facilitator downtime failed closed without repeated paid retries. |  |
| `PAYMENT_RESPONSE_PRESENT` | `PASS` | `pass` | missing PAYMENT-RESPONSE after paid path | Paid response without PAYMENT-RESPONSE was blocked. |  |
| `PAYMENT_RESPONSE_PRESENT` | `PASS` | `pass` | missing X-PAYMENT-RESPONSE if applicable | X-PAYMENT-RESPONSE is accepted as receipt proof when present. |  |
| `PAID_BUT_DENIED_RISK` | `PASS` | `pass` | paid-but-denied risk analysis | A denial response after payment was treated as a failed flow. |  |

## Payment Intent

- Fingerprint: `fnv1a:af3f66c6`

## Repeated Challenge Stability

- `PAYTO_STABLE` PASS: payTo remained stable across repeated challenge requests.
- `AMOUNT_STABLE` PASS: amount remained stable across repeated challenge requests.
- `RESOURCE_STABLE` PASS: resource remained stable across repeated challenge requests.
- `CHALLENGE_REPEAT_STABLE` PASS: Repeated challenge requests returned parseable x402 requirements.

## Retry Loop Simulation

- `RETRY_LOOP_RISK` PASS: Paid fetch returned another 402 and Safe402 stopped instead of retrying payment.
- `RETRY_LOOP_RISK` PASS: A permanent paid-response error did not trigger repeated paid retries.
- `RETRY_LOOP_RISK` PASS: Unsupported chain was denied before any paid retry.
- `RETRY_LOOP_RISK` PASS: Expired challenge was denied before paid retry.
- `RETRY_LOOP_RISK` PASS: Facilitator downtime failed closed without repeated paid retries.
- `PAYMENT_RESPONSE_PRESENT` PASS: Paid response without PAYMENT-RESPONSE was blocked.
- `PAYMENT_RESPONSE_PRESENT` PASS: X-PAYMENT-RESPONSE is accepted as receipt proof when present.
- `PAID_BUT_DENIED_RISK` PASS: A denial response after payment was treated as a failed flow.

## Duplicate Payment Simulation

- `DUPLICATE_PAYMENT_RISK` PASS: A repeated payment attempt for the same intent was blocked by duplicate detection.
- `PAYMENT_IDENTIFIER_PRESENT` PASS: The requirement includes a payment identifier or idempotency key that can bind duplicate retries.

## Metadata And Privacy Findings

- `NO_PII_IN_METADATA` PASS: Description metadata did not expose PII.
- `NO_PII_IN_METADATA` PASS: Resource URL did not expose sensitive query parameters or PII.
- `NO_PII_IN_METADATA` PASS: Reason strings did not expose PII.
- `NO_PII_IN_METADATA` PASS: Payment metadata did not expose API keys or bearer tokens.
- `NO_PII_IN_METADATA` PASS: Metadata did not link wallet identity to sensitive context.
