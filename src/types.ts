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
  chain?: string;
  asset?: string;
  assetDecimals?: number;
  payTo?: string;
  facilitator?: string;
  maxAmountRequired?: string;
  amount?: string;
  amountUsd?: number | string;
  resource?: string;
  description?: string;
  mimeType?: string;
  expiresAt?: string | number;
  ttl?: number;
  ttlSeconds?: number;
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
  allowedPayees?: string[];
  blockedPayees?: string[];
  blockedPayTo?: string[];
  allowedFacilitators?: string[];
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
  amount?: string;
  maxAmountRequired?: string;
  source?: "amountUsd" | "maxAmountRequired" | "amount";
  assetDecimals?: number;
  decimalsSource?: "requirement" | "extra" | "policy" | "known_asset" | "none";
  atomic?: boolean;
  warnings?: string[];
};

export type Safe402PrivacyFinding = {
  field: string;
  type:
    | "email"
    | "phone"
    | "secret"
    | "api_key"
    | "bearer_token"
    | "private_task_reason"
    | "sensitive_query"
    | "wallet_linked_note"
    | "personal_identifier";
  value?: string;
};
