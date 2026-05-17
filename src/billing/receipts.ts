import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  Safe402BillingConfig,
  Safe402BillingReceipt,
  Safe402BillingReceiptStore
} from "./types.js";
import { resolveBillingConfig } from "./types.js";

export type JsonFileBillingReceiptStoreOptions = {
  path: string;
};

export function createMemoryBillingReceiptStore(
  initialReceipts: Safe402BillingReceipt[] = []
): Safe402BillingReceiptStore {
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

export function createJsonFileBillingReceiptStore(
  options: JsonFileBillingReceiptStoreOptions
): Safe402BillingReceiptStore {
  const filePath = resolve(options.path);
  let writeQueue = Promise.resolve();

  return {
    async list() {
      return readBillingReceipts(filePath);
    },
    async save(receipt) {
      writeQueue = writeQueue.then(async () => {
        const receipts = await readBillingReceipts(filePath);
        receipts.push(receipt);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, `${JSON.stringify(receipts, null, 2)}\n`, "utf8");
      });

      return writeQueue;
    }
  };
}

export function resolveBillingReceiptStore(
  config: Partial<Safe402BillingConfig> = {}
): Safe402BillingReceiptStore {
  const resolved = resolveBillingConfig(config);

  if (resolved.receiptStore === "file") {
    return createJsonFileBillingReceiptStore({ path: resolved.receiptFile });
  }

  return createMemoryBillingReceiptStore();
}

async function readBillingReceipts(filePath: string): Promise<Safe402BillingReceipt[]> {
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isBillingReceiptLike) : [];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isBillingReceiptLike(value: unknown): value is Safe402BillingReceipt {
  return typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "billing_receipt" &&
    "mode" in value &&
    "product" in value &&
    "amountUsd" in value &&
    "createdAt" in value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
