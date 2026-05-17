# Safe402 Probe Report

Safe402 Probe: $0.01 per endpoint check

Checks: 0 passed, 1 failed, 0 warnings

## https://another-agent.com/paid-tool

- Decision: `BLOCKED_BY_POLICY`
- Explanation: Blocked by policy. Endpoint requested $2.00, but your max auto-spend is $0.25. This does not mean the provider is malicious. No accepts option matched the current policy.
- HTTP status: `402`

| Option | Category | Amount | Asset | Network | Payee | Reason |
| --- | --- | ---: | --- | --- | --- | --- |
| 1 | `BLOCKED_BY_POLICY` | $2.00 | USDC | base-sepolia | 0x0000000000000000000000000000000000000000 | Payment 2 exceeds per-call limit 0.25. |
