import { formatUsd } from "../pricing.js";
import type {
  Safe402BillingCollectionRequest,
  Safe402BillingConfig,
  Safe402BillingProvider,
  Safe402BillingReceipt,
  Safe402BillingReceiptStore,
  Safe402PaymentRequest
} from "./types.js";
import {
  createBillingReceipt,
  createPaymentRequest,
  resolveBillingConfig
} from "./types.js";

export type Safe402X402PaymentProof = {
  amountUsd?: number | string;
  totalUsd?: number | string;
  amount?: number | string;
  payTo?: string;
  network?: string;
  asset?: string;
  paymentRequestId?: string;
  quoteId?: string;
  receiptId?: string;
  transactionId?: string;
  txHash?: string;
  settlementProof?: string;
};

export type Safe402VerifiedX402Proof = {
  proof: Safe402X402PaymentProof;
  amountUsd: number;
  transactionId?: string;
  receiptId?: string;
};

export class X402BillingProvider implements Safe402BillingProvider {
  readonly mode = "x402" as const;
  readonly name = "x402";

  constructor(
    private readonly config: Safe402BillingConfig = resolveBillingConfig({ mode: "x402" }),
    private readonly receiptStore?: Safe402BillingReceiptStore
  ) {}

  async collect(input: Safe402BillingCollectionRequest): Promise<Safe402BillingReceipt> {
    const paymentRequest = createPaymentRequest({
      quote: input.quote,
      config: this.config
    });
    // TODO: replace env JSON proof validation with facilitator-backed x402 settlement verification.
    const proof = input.proof ?? process.env.SAFE402_X402_PAYMENT ?? process.env.SAFE402_PAYMENT_RECEIPT;

    if (!proof) {
      throw new Error([
        `Safe402 ${input.quote.product} requires x402 payment of exactly ${formatUsd(input.quote.totalUsd)} before execution.`,
        `Payment request ${paymentRequest.id} is ready for ${paymentRequest.payTo} on ${paymentRequest.network} using ${paymentRequest.asset}.`,
        "Set SAFE402_X402_PAYMENT to a JSON proof containing amountUsd, payTo, network, asset, and transactionId after payment."
      ].join(" "));
    }

    const verified = verifyX402PaymentProof({
      proof,
      paymentRequest
    });
    const receipt = createBillingReceipt({
      mode: this.mode,
      provider: this.name,
      quote: input.quote,
      required: true,
      paid: true,
      paymentRequest,
      receiptId: verified.receiptId ?? `x402-${paymentRequest.id}-${Date.now()}`,
      transactionId: verified.transactionId,
      verificationStatus: "x402_verified",
      message: `x402 billing proof accepted for exact Safe402 ${input.quote.product} amount ${formatUsd(input.quote.totalUsd)}.`,
      metadata: {
        ...(input.metadata ?? {}),
        settlementProofPresent: Boolean(verified.proof.settlementProof),
        facilitatorUrl: this.config.facilitatorUrl,
        x402ProviderTodo: "Replace environment proof validation with facilitator settlement verification before production collection."
      }
    });

    await (input.receiptStore ?? this.receiptStore)?.save(receipt);
    return receipt;
  }
}

export function verifyX402PaymentProof(input: {
  proof: string;
  paymentRequest: Safe402PaymentRequest;
}): Safe402VerifiedX402Proof {
  const proof = parseX402PaymentProof(input.proof);
  const amountUsd = readProofAmountUsd(proof);

  if (amountUsd === undefined) {
    throw new Error("SAFE402_X402_PAYMENT must include amountUsd, totalUsd, or amount so Safe402 can verify the exact quote amount.");
  }

  if (!sameUsd(amountUsd, input.paymentRequest.amountUsd)) {
    throw new Error(`SAFE402_X402_PAYMENT amount ${formatUsd(amountUsd)} does not match exact quote ${formatUsd(input.paymentRequest.amountUsd)}.`);
  }

  if (proof.payTo && input.paymentRequest.payTo && !sameToken(proof.payTo, input.paymentRequest.payTo)) {
    throw new Error("SAFE402_X402_PAYMENT payTo does not match SAFE402_BILLING_PAY_TO.");
  }

  if (proof.network && input.paymentRequest.network && proof.network !== input.paymentRequest.network) {
    throw new Error("SAFE402_X402_PAYMENT network does not match SAFE402_BILLING_NETWORK.");
  }

  if (proof.asset && input.paymentRequest.asset && !sameToken(proof.asset, input.paymentRequest.asset)) {
    throw new Error("SAFE402_X402_PAYMENT asset does not match SAFE402_BILLING_ASSET.");
  }

  if (proof.paymentRequestId && proof.paymentRequestId !== input.paymentRequest.id) {
    throw new Error("SAFE402_X402_PAYMENT paymentRequestId does not match the current Safe402 payment request.");
  }

  if (proof.quoteId && proof.quoteId !== input.paymentRequest.quoteId) {
    throw new Error("SAFE402_X402_PAYMENT quoteId does not match the current Safe402 quote.");
  }

  return {
    proof,
    amountUsd,
    transactionId: proof.transactionId ?? proof.txHash,
    receiptId: proof.receiptId
  };
}

function parseX402PaymentProof(value: string): Safe402X402PaymentProof {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Safe402X402PaymentProof;
    }
  } catch {
    throw new Error("SAFE402_X402_PAYMENT must be JSON in this billing abstraction pass.");
  }

  throw new Error("SAFE402_X402_PAYMENT must be a JSON object.");
}

function readProofAmountUsd(proof: Safe402X402PaymentProof): number | undefined {
  const value = proof.amountUsd ?? proof.totalUsd ?? proof.amount;

  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sameUsd(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

function sameToken(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
