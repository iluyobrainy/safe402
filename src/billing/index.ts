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
