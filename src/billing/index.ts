import type { Safe402Receipt, Safe402ReceiptStore } from "../types.js";

export const DEFAULT_DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
export const DEFAULT_PAID_DENIAL_STATUS_CODES = [401, 403];

export function createMemoryReceiptStore(initialReceipts: Safe402Receipt[] = []): Safe402ReceiptStore {
  const receipts = [...initialReceipts];

  return {
    async list() {
      return [...receipts];
    },
    async save(receipt) {
      receipts.push(receipt);
    }
  };
}

export function getSpentTodayUsd(receipts: Safe402Receipt[]): number {
  return receipts
    .filter(receipt => receipt.status === "paid")
    .filter(receipt => isTodayUtc(receipt.timestamp))
    .reduce((sum, receipt) => sum + receipt.amountUsd, 0);
}

export function isTodayUtc(timestamp: string): boolean {
  const input = new Date(timestamp);
  const now = new Date();

  return input.getUTCFullYear() === now.getUTCFullYear() &&
    input.getUTCMonth() === now.getUTCMonth() &&
    input.getUTCDate() === now.getUTCDate();
}

export {
  describeProbePricing,
  collectProbeBilling,
  enforceProbeBilling,
  type Safe402ProbeBillingReceipt
} from "./probeBilling.js";

export {
  additionalPaymentRequired,
  collectAuditBilling,
  createAuditPaymentRequest,
  enforceAuditBilling,
  type Safe402AdditionalPaymentRequired,
  type Safe402AuditBillingPaymentRequest,
  type Safe402AuditBillingReceipt
} from "./auditBilling.js";

export {
  ProbeQuoteEngine,
  AuditQuoteEngine,
  auditQuoteEngine,
  probeQuoteEngine,
  quoteAuditBilling,
  quoteProbeBilling,
  type AuditQuoteLike,
  type ProbeQuoteInput
} from "./quote.js";

export {
  createMemoryBillingReceiptStore,
  createJsonFileBillingReceiptStore,
  resolveBillingReceiptStore,
  type JsonFileBillingReceiptStoreOptions
} from "./receipts.js";

export {
  DisabledBillingProvider
} from "./disabledBilling.js";

export {
  MockBillingProvider
} from "./mockBilling.js";

export {
  X402BillingProvider,
  verifyX402PaymentProof,
  type Safe402VerifiedX402Proof,
  type Safe402X402PaymentProof
} from "./x402Billing.js";

export {
  collectBilling,
  createBillingProvider,
  type CollectBillingInput
} from "./providers.js";

export {
  createBillingReceipt,
  createPaymentRequest,
  resolveBillingConfig,
  resolveBillingMode,
  type Safe402BillingCollectionRequest,
  type Safe402BillingConfig,
  type Safe402BillingMode,
  type Safe402BillingProduct,
  type Safe402BillingProvider,
  type Safe402BillingQuote,
  type Safe402BillingQuoteLineItem,
  type Safe402BillingReceipt,
  type Safe402BillingReceiptStore,
  type Safe402BillingReceiptStoreKind,
  type Safe402PaymentRequest
} from "./types.js";
