import {
  DEFAULT_PAID_DENIAL_STATUS_CODES,
  createMemoryReceiptStore
} from "./billing/index.js";
import { evaluatePayment, loadPolicy } from "./policy/index.js";
import type {
  Safe402Decision,
  Safe402FetchConfig,
  Safe402Receipt,
  Safe402ReceiptStore
} from "./types.js";
import {
  getRequestMethod,
  extractPaymentRequirement,
  normalizeUrl,
  stableHash,
  summarizeRequestBody,
  toUrl
} from "./utils/index.js";

export class Safe402Error extends Error {
  decision: Safe402Decision;

  constructor(decision: Safe402Decision) {
    super(decision.reason);
    this.name = "Safe402Error";
    this.decision = decision;
  }
}

export function createSafe402Fetch(config: Safe402FetchConfig): typeof fetch {
  const rawFetch = config.fetch ?? globalThis.fetch;
  const receipts = config.receipts ?? createMemoryReceiptStore();

  return async (input, init) => {
    const url = toUrl(input);
    const policy = loadPolicy(config.policy);
    const requestIntentBeforeChallenge = createRequestIntentFingerprint(input, init);
    const firstResponse = await rawFetch(input, init);

    if (firstResponse.status !== 402) {
      await record(receipts, config, {
        status: "free",
        reason: "No x402 payment was required.",
        url: url.href,
        domain: url.hostname,
        amountUsd: 0,
        timestamp: new Date().toISOString()
      }, firstResponse);
      return firstResponse;
    }

    const requirement = await extractPaymentRequirement(firstResponse);
    const paymentIntent = stablePaymentIntent({ input, init, requirement });
    const decision = await evaluatePayment({
      url,
      requirement,
      policy,
      receipts,
      paymentIntent
    });

    if (decision.status === "approval_required") {
      const approved = await config.onApprovalRequired?.(decision);
      if (!approved) {
        const denied = { ...decision, status: "denied" as const, reason: "Human approval was required and not granted." };
        await record(receipts, config, denied);
        throw new Safe402Error(denied);
      }
    } else if (decision.status === "denied") {
      await record(receipts, config, decision);
      throw new Safe402Error(decision);
    }

    const requestIntentBeforePayment = createRequestIntentFingerprint(input, init);
    if (policy.blockPaymentIntentChanges !== false && requestIntentBeforeChallenge !== requestIntentBeforePayment) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: "Request intent changed between the 402 challenge and paid retry.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision);
      throw new Safe402Error(failedDecision);
    }

    let paidResponse: Response;
    try {
      paidResponse = await config.paidFetch(input, init);
    } catch (error) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: error instanceof Error ? `Paid fetch failed: ${error.message}` : "Paid fetch failed.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision);
      throw new Safe402Error(failedDecision);
    }

    if (paidResponse.status === 402) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: "Paid fetch returned another 402; retry fuse stopped to avoid a payment loop.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision, paidResponse);
      throw new Safe402Error(failedDecision);
    }

    const paymentResponse = getPaymentResponseHeader(paidResponse);
    if (policy.requirePaymentResponseHeader && !paymentResponse) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: "Paid response is missing PAYMENT-RESPONSE header.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision, paidResponse);
      throw new Safe402Error(failedDecision);
    }

    const paidDenialCodes = policy.failOnPaidStatusCodes ?? DEFAULT_PAID_DENIAL_STATUS_CODES;
    if (paidDenialCodes.includes(paidResponse.status)) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: `Paid response returned ${paidResponse.status}; possible paid-but-denied flow.`,
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision, paidResponse);
      throw new Safe402Error(failedDecision);
    }

    const paidDecision: Safe402Decision = {
      ...decision,
      status: "paid",
      reason: "Payment passed Safe402 policy and paid fetch completed.",
      timestamp: new Date().toISOString()
    };

    await record(receipts, config, paidDecision, paidResponse);
    return paidResponse;
  };
}

async function record(
  receipts: Safe402ReceiptStore,
  config: Safe402FetchConfig,
  decision: Safe402Decision,
  response?: Response
) {
  const receipt: Safe402Receipt = {
    ...decision,
    responseStatus: response?.status,
    paymentResponse: response ? getPaymentResponseHeader(response) : null
  };

  await receipts.save(receipt);
  await config.onDecision?.(decision);
}

function getPaymentResponseHeader(response: Response): string | null {
  return response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE") ?? null;
}

function createRequestIntentFingerprint(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): string {
  const url = toUrl(input);
  return stableHash({
    method: getRequestMethod(input, init),
    url: normalizeUrl(url),
    body: summarizeRequestBody(input, init)
  });
}

function stablePaymentIntent(input: {
  input: Parameters<typeof fetch>[0];
  init?: Parameters<typeof fetch>[1];
  requirement?: import("./types.js").Safe402PaymentRequirement;
}): string {
  const url = toUrl(input.input);
  return stableHash({
    method: getRequestMethod(input.input, input.init),
    url: normalizeUrl(url),
    body: summarizeRequestBody(input.input, input.init),
    requirement: {
      scheme: input.requirement?.scheme,
      network: input.requirement?.network,
      asset: input.requirement?.asset,
      payTo: input.requirement?.payTo,
      maxAmountRequired: input.requirement?.maxAmountRequired,
      amount: input.requirement?.amount,
      resource: input.requirement?.resource,
      description: input.requirement?.description,
      mimeType: input.requirement?.mimeType
    }
  });
}
