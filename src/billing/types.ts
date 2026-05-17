export type Safe402BillingMode = "disabled" | "mock" | "x402";

export type Safe402BillingProduct =
  | "probe"
  | "audit"
  | "subscription"
  | "hosted_report";

export type Safe402BillingReceiptStoreKind = "memory" | "file";

export type Safe402BillingConfig = {
  mode: Safe402BillingMode;
  payTo?: string;
  network?: "base" | "base-sepolia" | string;
  asset?: string;
  facilitatorUrl?: string;
  receiptStore: Safe402BillingReceiptStoreKind;
  receiptFile: string;
};

export type Safe402BillingQuoteLineItem = {
  label: string;
  unitUsd?: number;
  quantity: number;
  totalUsd?: number;
};

export type Safe402BillingQuote = {
  kind: "billing_quote";
  id: string;
  product: Safe402BillingProduct;
  description: string;
  currency: "USD";
  totalUsd: number;
  priceBreakdown: Safe402BillingQuoteLineItem[];
  metadata?: Record<string, unknown>;
};

export type Safe402PaymentRequest = {
  id: string;
  quoteId: string;
  product: Safe402BillingProduct;
  description: string;
  amountUsd: number;
  currency: "USD";
  payTo?: string;
  network?: string;
  asset?: string;
  facilitatorUrl?: string;
  metadata?: Record<string, unknown>;
};

export type Safe402BillingReceipt = {
  kind: "billing_receipt";
  id: string;
  mode: Safe402BillingMode;
  provider: string;
  product: Safe402BillingProduct;
  quoteId: string;
  required: boolean;
  paid: boolean;
  amountUsd: number;
  currency: "USD";
  paymentRequest?: Safe402PaymentRequest;
  receiptId?: string;
  transactionId?: string;
  verificationStatus: "disabled" | "mock_verified" | "x402_verified" | "x402_proof_required";
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type Safe402BillingCollectionRequest = {
  quote: Safe402BillingQuote;
  proof?: string;
  receiptStore?: Safe402BillingReceiptStore;
  metadata?: Record<string, unknown>;
};

export type Safe402BillingProvider = {
  readonly mode: Safe402BillingMode;
  readonly name: string;
  collect(input: Safe402BillingCollectionRequest): Promise<Safe402BillingReceipt>;
};

export type Safe402BillingReceiptStore = {
  list(): Promise<Safe402BillingReceipt[]>;
  save(receipt: Safe402BillingReceipt): Promise<void>;
};

export const BILLING_MODES = new Set<Safe402BillingMode>(["disabled", "mock", "x402"]);

export function resolveBillingMode(
  input?: string,
  envValue = process.env.SAFE402_BILLING_MODE
): Safe402BillingMode {
  const value = (input ?? envValue ?? "disabled").toLowerCase();

  if (BILLING_MODES.has(value as Safe402BillingMode)) {
    return value as Safe402BillingMode;
  }

  throw new Error("SAFE402_BILLING_MODE must be disabled, mock, or x402.");
}

export function resolveBillingConfig(input: Partial<Safe402BillingConfig> = {}): Safe402BillingConfig {
  const mode = input.mode ?? resolveBillingMode();
  const receiptStore = input.receiptStore ?? resolveReceiptStoreKind(process.env.SAFE402_BILLING_RECEIPT_STORE);
  const config: Safe402BillingConfig = {
    mode,
    payTo: input.payTo ?? process.env.SAFE402_BILLING_PAY_TO,
    network: input.network ?? process.env.SAFE402_BILLING_NETWORK,
    asset: input.asset ?? process.env.SAFE402_BILLING_ASSET,
    facilitatorUrl: input.facilitatorUrl ?? process.env.SAFE402_BILLING_FACILITATOR_URL,
    receiptStore,
    receiptFile: input.receiptFile ?? process.env.SAFE402_BILLING_RECEIPT_FILE ?? "safe402-receipts.json"
  };

  if (config.mode === "x402") {
    validateX402Config(config);
  }

  return config;
}

export function createPaymentRequest(input: {
  quote: Safe402BillingQuote;
  config: Safe402BillingConfig;
}): Safe402PaymentRequest {
  return {
    id: `safe402-${input.quote.product}-${input.quote.id}`,
    quoteId: input.quote.id,
    product: input.quote.product,
    description: input.quote.description,
    amountUsd: input.quote.totalUsd,
    currency: input.quote.currency,
    payTo: input.config.payTo,
    network: input.config.network,
    asset: input.config.asset,
    facilitatorUrl: input.config.facilitatorUrl,
    metadata: input.quote.metadata
  };
}

export function createBillingReceipt(input: {
  mode: Safe402BillingMode;
  provider: string;
  quote: Safe402BillingQuote;
  required: boolean;
  paid: boolean;
  paymentRequest?: Safe402PaymentRequest;
  receiptId?: string;
  transactionId?: string;
  verificationStatus: Safe402BillingReceipt["verificationStatus"];
  message: string;
  metadata?: Record<string, unknown>;
}): Safe402BillingReceipt {
  const now = new Date().toISOString();
  const receiptId = input.receiptId ?? `${input.mode}-${input.quote.id}-${Date.now()}`;

  return {
    kind: "billing_receipt",
    id: receiptId,
    mode: input.mode,
    provider: input.provider,
    product: input.quote.product,
    quoteId: input.quote.id,
    required: input.required,
    paid: input.paid,
    amountUsd: input.quote.totalUsd,
    currency: input.quote.currency,
    paymentRequest: input.paymentRequest,
    receiptId,
    transactionId: input.transactionId,
    verificationStatus: input.verificationStatus,
    message: input.message,
    createdAt: now,
    metadata: input.metadata
  };
}

function resolveReceiptStoreKind(value: string | undefined): Safe402BillingReceiptStoreKind {
  const normalized = (value ?? "memory").toLowerCase();

  if (normalized === "memory" || normalized === "file") {
    return normalized;
  }

  throw new Error("SAFE402_BILLING_RECEIPT_STORE must be memory or file.");
}

function validateX402Config(config: Safe402BillingConfig) {
  if (!config.payTo) {
    throw new Error("SAFE402_BILLING_PAY_TO is required when SAFE402_BILLING_MODE=x402.");
  }

  if (!config.network) {
    throw new Error("SAFE402_BILLING_NETWORK is required when SAFE402_BILLING_MODE=x402.");
  }

  if (config.network !== "base" && config.network !== "base-sepolia") {
    throw new Error("SAFE402_BILLING_NETWORK must be base or base-sepolia.");
  }

  if (!config.asset) {
    throw new Error("SAFE402_BILLING_ASSET is required when SAFE402_BILLING_MODE=x402.");
  }
}
