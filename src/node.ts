import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Safe402Receipt, Safe402ReceiptStore } from "./types.js";

export type JsonFileReceiptStoreOptions = {
  path: string;
};

export function createJsonFileReceiptStore(options: JsonFileReceiptStoreOptions): Safe402ReceiptStore {
  const filePath = resolve(options.path);
  let writeQueue = Promise.resolve();

  return {
    async list() {
      return readReceipts(filePath);
    },
    async save(receipt) {
      writeQueue = writeQueue.then(async () => {
        const receipts = await readReceipts(filePath);
        receipts.push(receipt);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, `${JSON.stringify(receipts, null, 2)}\n`, "utf8");
      });

      return writeQueue;
    }
  };
}

async function readReceipts(filePath: string): Promise<Safe402Receipt[]> {
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isReceiptLike) : [];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isReceiptLike(value: unknown): value is Safe402Receipt {
  return typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "url" in value &&
    "timestamp" in value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
