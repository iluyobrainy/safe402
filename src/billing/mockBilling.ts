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

export class MockBillingProvider implements Safe402BillingProvider {
  readonly mode = "mock" as const;
  readonly name = "mock";

  constructor(
    private readonly config: Safe402BillingConfig = resolveBillingConfig({ mode: "mock" }),
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
      required: true,
      paid: true,
      paymentRequest,
      receiptId: `mock-${paymentRequest.id}-${Date.now()}`,
      transactionId: `mock-${input.quote.id}`,
      verificationStatus: "mock_verified",
      message: `Mock billing accepted ${formatUsd(input.quote.totalUsd)} for Safe402 ${input.quote.product}.`,
      metadata: {
        ...(input.metadata ?? {}),
        simulated: true
      }
    });

    await (input.receiptStore ?? this.receiptStore)?.save(receipt);
    return receipt;
  }
}
