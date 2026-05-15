# Security

Safe402 is a policy and audit layer for x402 agent payments. It does not custody funds, create wallets, or settle payments.

## Reporting

Please report security issues privately by opening a GitHub issue with minimal public detail and asking for a private contact path.

## Scope

Relevant issues include:

- bypasses in payment policy evaluation
- duplicate-payment protection failures
- receipt-store corruption or unsafe parsing
- metadata leakage in Safe402-generated outputs
- CLI behavior that pays or signs unexpectedly

The `safe402 audit --url` command only performs unpaid preflight requests. It should not sign payments or call the configured paid fetch.
