import { DisabledBillingProvider } from "./disabledBilling.js";
import { MockBillingProvider } from "./mockBilling.js";
import type {
  Safe402BillingConfig,
  Safe402BillingMode,
  Safe402BillingProvider,
  Safe402BillingQuote,
  Safe402BillingReceipt,
  Safe402BillingReceiptStore
} from "./types.js";
import { resolveBillingConfig } from "./types.js";
import { X402BillingProvider } from "./x402Billing.js";
import { resolveBillingReceiptStore } from "./receipts.js";

export type CollectBillingInput = {
  quote: Safe402BillingQuote;
  mode?: Safe402BillingMode;
  proof?: string;
  config?: Partial<Safe402BillingConfig>;
  receiptStore?: Safe402BillingReceiptStore;
  metadata?: Record<string, unknown>;
};

export function createBillingProvider(
  config: Safe402BillingConfig = resolveBillingConfig(),
  receiptStore?: Safe402BillingReceiptStore
): Safe402BillingProvider {
  if (config.mode === "disabled") {
    return new DisabledBillingProvider(config, receiptStore);
  }

  if (config.mode === "mock") {
    return new MockBillingProvider(config, receiptStore);
  }

  return new X402BillingProvider(config, receiptStore);
}

export async function collectBilling(input: CollectBillingInput): Promise<Safe402BillingReceipt> {
  const config = resolveBillingConfig({
    ...(input.config ?? {}),
    mode: input.mode ?? input.config?.mode
  });
  const receiptStore = input.receiptStore ?? resolveBillingReceiptStore(config);
  const provider = createBillingProvider(config, receiptStore);

  return provider.collect({
    quote: input.quote,
    proof: input.proof,
    receiptStore,
    metadata: input.metadata
  });
}
