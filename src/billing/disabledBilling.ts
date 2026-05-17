import { formatUsd } from "../pricing.js";
import type {
  Safe402BillingCollectionRequest,
  Safe402BillingConfig,
  Safe402BillingProvider,
  Safe402BillingReceipt,
  Safe402BillingReceiptStore
} from "./types.js";
import {
  createBillingReceipt,
  createPaymentRequest,
  resolveBillingConfig
} from "./types.js";

export class DisabledBillingProvider implements Safe402BillingProvider {
  readonly mode = "disabled" as const;
  readonly name = "disabled";

  constructor(
    private readonly config: Safe402BillingConfig = resolveBillingConfig({ mode: "disabled" }),
    private readonly receiptStore?: Safe402BillingReceiptStore
  ) {}

  async collect(input: Safe402BillingCollectionRequest): Promise<Safe402BillingReceipt> {
    const paymentRequest = createPaymentRequest({
      quote: input.quote,
      config: this.config
    });
    const receipt = createBillingReceipt({
      mode: this.mode,
      provider: this.name,
      quote: input.quote,
      required: false,
      paid: false,
      paymentRequest,
      verificationStatus: "disabled",
      message: `Billing disabled; ${input.quote.product} price ${formatUsd(input.quote.totalUsd)} is shown for transparency and local testing continues without payment.`,
      metadata: {
        ...(input.metadata ?? {}),
        unpaid: true,
        local: true
      }
    });

    await (input.receiptStore ?? this.receiptStore)?.save(receipt);
    return receipt;
  }
}
