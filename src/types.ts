export type Safe402DecisionStatus =
  | "approved"
  | "denied"
  | "approval_required"
  | "paid"
  | "failed"
  | "free";

export type Safe402PaymentRequirement = {
  scheme?: string;
  network?: string;
  asset?: string;
  assetDecimals?: number;
  payTo?: string;
  maxAmountRequired?: string;
  amount?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
};

export type Safe402Policy = {
  maxPaymentUsd?: number;
  dailyBudgetUsd?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedNetworks?: string[];
  allowedAssets?: string[];
  allowedPayTo?: string[];
  assetDecimalsByAsset?: Record<string, number>;
  defaultAssetDecimals?: number;
  blockSensitiveMetadata?: boolean;
  blockPaymentIntentChanges?: boolean;
  requirePaymentResponseHeader?: boolean;
  failOnPaidStatusCodes?: number[];
  requireApprovalAboveUsd?: number;
  duplicateWindowMs?: number;
};

export type Safe402Decision = {
  status: Safe402DecisionStatus;
  reason: string;
  url: string;
  domain: string;
  amountUsd: number;
  requirement?: Safe402PaymentRequirement;
  paymentIntent?: string;
  duplicateKey?: string;
  timestamp: string;
};

export type Safe402Receipt = Safe402Decision & {
  responseStatus?: number;
  paymentResponse?: string | null;
};

export type Safe402ReceiptStore = {
  list(): Promise<Safe402Receipt[]>;
  save(receipt: Safe402Receipt): Promise<void>;
};

export type Safe402FetchConfig = {
  fetch?: typeof fetch;
  paidFetch: typeof fetch;
  policy?: Safe402Policy;
  receipts?: Safe402ReceiptStore;
  onDecision?: (decision: Safe402Decision) => void | Promise<void>;
  onApprovalRequired?: (decision: Safe402Decision) => boolean | Promise<boolean>;
};

export type Safe402PaymentIntentInput = {
  input: Parameters<typeof fetch>[0];
  init?: Parameters<typeof fetch>[1];
  requirement?: Safe402PaymentRequirement;
};

export type Safe402ParsedAmount = {
  valid: boolean;
  amountUsd: number;
  raw: string | undefined;
  reason: string;
};

export type Safe402PrivacyFinding = {
  field: string;
  type: "email" | "phone" | "secret" | "sensitive_query";
};
