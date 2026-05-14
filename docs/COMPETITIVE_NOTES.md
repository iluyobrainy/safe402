# Competitive Notes

This market is real, and Safe402 is not the only project thinking about agent payment safety.

The goal is not to pretend there are no competitors. The goal is to choose a wedge that is small, useful, and differentiated.

## Similar Products

### SpendGate

SpendGate positions as a proxy layer for agent control across standard APIs and x402 payments. It includes policies, spend controls, signed webhooks, and audit trails.

Difference from Safe402:

- SpendGate is proxy/dashboard-first.
- Safe402 should be SDK-first and local-first.
- Safe402 should require no hosted account for the default path.

### Sentinel

Sentinel positions as an audit and compliance layer for x402 payments. Its docs describe an SDK wrapper, budget policies, audit ledger, storage backends, dashboard, API, and proxy mode.

Difference from Safe402:

- Sentinel appears close to the broad Safe402 idea.
- Safe402 should stay narrower at first: tiny SDK, transparent storage, MCP wrapper, no enterprise dashboard dependency.

### GuardX402

GuardX402 describes a policy and audit layer for x402 payments, with spend enforcement, budget tracking, audit logs, team access controls, and an API-based guard check.

Difference from Safe402:

- GuardX402 is API/dashboard-first and tied to Open Wallet Standard in its docs.
- Safe402 should be wallet-agnostic and work with any existing x402-aware fetch.

### AgentPay

AgentPay is more payment-layer focused: managed wallets, payment signing, and automatic 402 handling.

Difference from Safe402:

- AgentPay helps agents pay.
- Safe402 helps developers decide whether the agent should pay.
- Safe402 should integrate with payment clients instead of replacing them.

### xpay

xpay describes a broader agentic payments infrastructure suite: marketplace, smart proxy, paywall-as-a-service, and transaction explorer.

Difference from Safe402:

- xpay is broad infrastructure.
- Safe402 should be the smallest possible safety wrapper developers can add to code.

## Safe402's Best Differentiation

Safe402 should be:

- open-source first
- SDK-first
- local-first by default
- no account required
- no hosted proxy required
- wallet-agnostic
- x402-client-agnostic
- MCP-ready
- transparent about storage and control

The message:

> Use your existing x402 client. Safe402 adds policy, receipts, duplicate blocking, and approval before the wallet signs.

## Risk

If Safe402 is only a max-spend check, it can be replaced by an x402 client update.

To matter, Safe402 must own the boring safety layer:

- receipt history
- budget memory
- duplicate detection
- policy presets
- MCP tool wrapper
- approval workflows
- storage adapters
- clear local-first docs

## Good Initial Wedge

Build the package people can install without permission:

```ts
const safeFetch = createSafe402Fetch({
  paidFetch,
  policy,
  receipts
});
```

Then add:

1. demo showing approved/blocked/duplicate payments
2. MCP wrapper
3. SQLite and file receipt stores
4. optional hosted dashboard after users ask for shared visibility

