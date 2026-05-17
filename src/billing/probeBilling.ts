import {
  PROBE_PRICE_USD,
  calculateProbePrice,
  formatUsd
} from "../pricing.js";
import { collectBilling } from "./providers.js";
import { quoteProbeBilling } from "./quote.js";
import type {
  Safe402BillingConfig,
  Safe402BillingMode,
  Safe402BillingReceipt,
  Safe402BillingReceiptStore
} from "./types.js";
import {
  createBillingReceipt,
  createPaymentRequest,
  resolveBillingConfig,
  resolveBillingMode
} from "./types.js";
import { verifyX402PaymentProof } from "./x402Billing.js";

export type { Safe402BillingMode };

export type Safe402ProbeBillingReceipt = Safe402BillingReceipt & {
  unitPriceUsd: number;
  endpointChecks: number;
  totalUsd: number;
};

export type ProbeBillingInput = {
  endpointChecks: number;
  mode: Safe402BillingMode;
  proof?: string;
  config?: Partial<Safe402BillingConfig>;
  receiptStore?: Safe402BillingReceiptStore;
};

export function describeProbePricing(endpointCount = 1): string {
  const suffix = endpointCount === 1
    ? "endpoint check"
    : `${endpointCount} endpoint checks`;
  return `Safe402 Probe: ${formatUsd(PROBE_PRICE_USD)} per endpoint check (${formatUsd(calculateProbePrice(endpointCount))} for ${suffix})`;
}

export async function collectProbeBilling(input: ProbeBillingInput): Promise<Safe402ProbeBillingReceipt> {
  const quote = quoteProbeBilling({ endpointChecks: input.endpointChecks });
  const receipt = await collectBilling({
    quote,
    mode: input.mode,
    proof: input.proof,
    config: input.config,
    receiptStore: input.receiptStore,
    metadata: {
      endpointChecks: input.endpointChecks,
      unitPriceUsd: PROBE_PRICE_USD
    }
  });

  return withProbePricing(receipt, input.endpointChecks);
}

export function enforceProbeBilling(input: {
  endpointChecks: number;
  mode: Safe402BillingMode;
  proof?: string;
}): Safe402ProbeBillingReceipt {
  const quote = quoteProbeBilling({ endpointChecks: input.endpointChecks });
  const config = resolveBillingConfig({ mode: input.mode });
  const paymentRequest = createPaymentRequest({ quote, config });

  if (input.mode === "disabled") {
    return withProbePricing(createBillingReceipt({
      mode: input.mode,
      provider: "disabled",
      quote,
      required: false,
      paid: false,
      paymentRequest,
      verificationStatus: "disabled",
      message: "Billing disabled; price shown for transparency and local testing continues without payment."
    }), input.endpointChecks);
  }

  if (input.mode === "mock") {
    return withProbePricing(createBillingReceipt({
      mode: input.mode,
      provider: "mock",
      quote,
      required: true,
      paid: true,
      paymentRequest,
      receiptId: `mock-${paymentRequest.id}`,
      transactionId: `mock-${quote.id}`,
      verificationStatus: "mock_verified",
      message: `Mock billing accepted ${formatUsd(quote.totalUsd)} for Safe402 Probe.`
    }), input.endpointChecks);
  }

  const proof = input.proof ?? process.env.SAFE402_X402_PAYMENT ?? process.env.SAFE402_PAYMENT_RECEIPT;

  if (!proof) {
    throw new Error(`Safe402 Probe requires x402 payment of exactly ${formatUsd(quote.totalUsd)} before returning the full report. Payment request ${paymentRequest.id} is ready; set SAFE402_X402_PAYMENT after payment, or use SAFE402_BILLING_MODE=disabled for local development.`);
  }

  const verified = verifyX402PaymentProof({ proof, paymentRequest });

  return withProbePricing(createBillingReceipt({
    mode: input.mode,
    provider: "x402",
    quote,
    required: true,
    paid: true,
    paymentRequest,
    receiptId: verified.receiptId ?? `x402-${paymentRequest.id}`,
    transactionId: verified.transactionId,
    verificationStatus: "x402_verified",
    message: "x402 billing proof detected and exact Safe402 Probe amount accepted.",
    metadata: {
      x402ProviderTodo: "Replace environment proof validation with facilitator settlement verification before production collection."
    }
  }), input.endpointChecks);
}

export { resolveBillingMode };

function withProbePricing(
  receipt: Safe402BillingReceipt,
  endpointChecks: number
): Safe402ProbeBillingReceipt {
  return {
    ...receipt,
    unitPriceUsd: PROBE_PRICE_USD,
    endpointChecks,
    totalUsd: calculateProbePrice(endpointChecks)
  };
}
