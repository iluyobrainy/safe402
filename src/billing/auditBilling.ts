import { formatUsd } from "../pricing.js";
import type { Safe402AuditQuote } from "../audit/quote.js";
import { collectBilling } from "./providers.js";
import { quoteAuditBilling } from "./quote.js";
import type {
  Safe402BillingConfig,
  Safe402BillingMode,
  Safe402BillingReceipt,
  Safe402BillingReceiptStore,
  Safe402PaymentRequest
} from "./types.js";
import {
  createBillingReceipt,
  createPaymentRequest,
  resolveBillingConfig
} from "./types.js";
import { verifyX402PaymentProof } from "./x402Billing.js";

export type Safe402AuditBillingPaymentRequest = Safe402PaymentRequest;

export type Safe402AuditBillingReceipt = Safe402BillingReceipt & {
  quoteTotalUsd: number;
  totalUsd: number;
};

export type Safe402AdditionalPaymentRequired = {
  code: "ADDITIONAL_PAYMENT_REQUIRED";
  currentQuoteUsd: number;
  additionalUsd: number;
  reason: string;
  suggestedAction: string;
};

export type AuditBillingInput = {
  quote: Safe402AuditQuote;
  mode: Safe402BillingMode;
  proof?: string;
  config?: Partial<Safe402BillingConfig>;
  receiptStore?: Safe402BillingReceiptStore;
};

export function createAuditPaymentRequest(
  quote: Safe402AuditQuote,
  config: Partial<Safe402BillingConfig> = { mode: "disabled" }
): Safe402AuditBillingPaymentRequest {
  const billingQuote = quoteAuditBilling(quote);
  return createPaymentRequest({
    quote: billingQuote,
    config: resolveBillingConfig(config)
  });
}

export async function collectAuditBilling(input: AuditBillingInput): Promise<Safe402AuditBillingReceipt> {
  if (input.quote.quoteBased) {
    throw new Error("Safe402 custom audits are quote-based. Confirm scope and price before running a paid audit.");
  }

  const billingQuote = quoteAuditBilling(input.quote);
  const receipt = await collectBilling({
    quote: billingQuote,
    mode: input.mode,
    proof: input.proof,
    config: input.config,
    receiptStore: input.receiptStore,
    metadata: {
      profile: input.quote.profile,
      endpointsCount: input.quote.endpointsCount,
      requestVariantsCount: input.quote.requestVariantsCount,
      mcpServersCount: input.quote.mcpServersCount,
      hostedReportEnabled: input.quote.hostedReportEnabled
    }
  });

  return withAuditPricing(receipt, input.quote.totalUsd);
}

export function enforceAuditBilling(input: {
  quote: Safe402AuditQuote;
  mode: Safe402BillingMode;
  proof?: string;
}): Safe402AuditBillingReceipt {
  if (input.quote.quoteBased) {
    throw new Error("Safe402 custom audits are quote-based. Confirm scope and price before running a paid audit.");
  }

  const billingQuote = quoteAuditBilling(input.quote);
  const config = resolveBillingConfig({ mode: input.mode });
  const paymentRequest = createPaymentRequest({ quote: billingQuote, config });

  if (input.mode === "disabled") {
    return withAuditPricing(createBillingReceipt({
      mode: input.mode,
      provider: "disabled",
      quote: billingQuote,
      required: false,
      paid: false,
      paymentRequest,
      verificationStatus: "disabled",
      message: "Audit billing disabled; quote shown for transparency and local testing continues without payment."
    }), input.quote.totalUsd);
  }

  if (input.mode === "mock") {
    return withAuditPricing(createBillingReceipt({
      mode: input.mode,
      provider: "mock",
      quote: billingQuote,
      required: true,
      paid: true,
      paymentRequest,
      receiptId: `mock-${paymentRequest.id}`,
      transactionId: `mock-${billingQuote.id}`,
      verificationStatus: "mock_verified",
      message: `Mock billing accepted exact Safe402 Audit quote of ${formatUsd(input.quote.totalUsd)}.`
    }), input.quote.totalUsd);
  }

  const proof = input.proof ?? process.env.SAFE402_X402_PAYMENT ?? process.env.SAFE402_PAYMENT_RECEIPT;

  if (!proof) {
    throw new Error(`Safe402 Audit requires x402 payment of exactly ${formatUsd(input.quote.totalUsd)} before running. Payment request ${paymentRequest.id} is ready; set SAFE402_X402_PAYMENT after payment, or use SAFE402_BILLING_MODE=disabled for local development.`);
  }

  const verified = verifyX402PaymentProof({ proof, paymentRequest });

  return withAuditPricing(createBillingReceipt({
    mode: input.mode,
    provider: "x402",
    quote: billingQuote,
    required: true,
    paid: true,
    paymentRequest,
    receiptId: verified.receiptId ?? `x402-${paymentRequest.id}`,
    transactionId: verified.transactionId,
    verificationStatus: "x402_verified",
    message: "x402 billing proof detected; exact Safe402 Audit quote accepted.",
    metadata: {
      x402ProviderTodo: "Replace environment proof validation with facilitator settlement verification before production collection."
    }
  }), input.quote.totalUsd);
}

export function additionalPaymentRequired(input: {
  currentQuoteUsd: number;
  additionalUsd: number;
  reason: string;
}): Safe402AdditionalPaymentRequired {
  return {
    code: "ADDITIONAL_PAYMENT_REQUIRED",
    currentQuoteUsd: input.currentQuoteUsd,
    additionalUsd: input.additionalUsd,
    reason: input.reason,
    suggestedAction: "Approve and pay the extra amount, rerun with approve-extra, or rerun with a larger audit profile."
  };
}

function withAuditPricing(
  receipt: Safe402BillingReceipt,
  quoteTotalUsd: number
): Safe402AuditBillingReceipt {
  return {
    ...receipt,
    quoteTotalUsd,
    totalUsd: quoteTotalUsd
  };
}
