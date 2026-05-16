import {
  getSpentTodayUsd
} from "./billing/index.js";
import { evaluatePayment } from "./policy/index.js";
import { createSafe402Fetch } from "./runtime.js";
import type {
  Safe402FetchConfig,
  Safe402PaymentRequirement,
  Safe402Policy,
  Safe402ReceiptStore
} from "./types.js";

export type Safe402McpConfig = {
  fetch?: typeof fetch;
  paidFetch?: typeof fetch;
  policy?: Safe402Policy;
  receipts: Safe402ReceiptStore;
};

export type Safe402McpTool<Input, Output> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(input: Input): Promise<Output>;
};

export type Safe402CheckPaymentInput = {
  url: string;
  requirement: Safe402PaymentRequirement;
};

export type Safe402PayResourceInput = {
  url: string;
  init?: RequestInit;
};

export type Safe402BudgetOutput = {
  dailyBudgetUsd: number | null;
  spentTodayUsd: number;
  remainingTodayUsd: number | null;
};

export type Safe402McpTools = {
  safe402_check_payment: Safe402McpTool<Safe402CheckPaymentInput, unknown>;
  safe402_pay_resource: Safe402McpTool<Safe402PayResourceInput, unknown>;
  safe402_get_receipts: Safe402McpTool<Record<string, never>, unknown>;
  safe402_get_budget: Safe402McpTool<Record<string, never>, Safe402BudgetOutput>;
};

export function createSafe402McpTools(config: Safe402McpConfig): Safe402McpTools {
  return {
    safe402_check_payment: {
      name: "safe402_check_payment",
      description: "Check whether an x402 payment requirement is allowed by Safe402 policy before paying.",
      inputSchema: {
        type: "object",
        required: ["url", "requirement"],
        properties: {
          url: { type: "string" },
          requirement: { type: "object" }
        }
      },
      handler: async input => {
        return evaluatePayment({
          url: new URL(input.url),
          requirement: input.requirement,
          policy: config.policy ?? {},
          receipts: config.receipts
        });
      }
    },
    safe402_pay_resource: {
      name: "safe402_pay_resource",
      description: "Fetch an x402-protected resource after Safe402 policy checks pass.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string" },
          init: { type: "object" }
        }
      },
      handler: async input => {
        if (!config.paidFetch) {
          throw new Error("safe402_pay_resource requires paidFetch in createSafe402McpTools config.");
        }

        const fetchConfig: Safe402FetchConfig = {
          fetch: config.fetch,
          paidFetch: config.paidFetch,
          receipts: config.receipts,
          policy: config.policy
        };
        const safeFetch = createSafe402Fetch(fetchConfig);
        const response = await safeFetch(input.url, input.init);
        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          return response.json();
        }

        return {
          status: response.status,
          body: await response.text()
        };
      }
    },
    safe402_get_receipts: {
      name: "safe402_get_receipts",
      description: "Return Safe402 payment decisions and receipts from the configured receipt store.",
      inputSchema: {
        type: "object",
        additionalProperties: false
      },
      handler: async () => {
        return config.receipts.list();
      }
    },
    safe402_get_budget: {
      name: "safe402_get_budget",
      description: "Return today's Safe402 spend and remaining daily budget.",
      inputSchema: {
        type: "object",
        additionalProperties: false
      },
      handler: async () => {
        const receipts = await config.receipts.list();
        const spentTodayUsd = getSpentTodayUsd(receipts);
        const dailyBudgetUsd = config.policy?.dailyBudgetUsd ?? null;

        return {
          dailyBudgetUsd,
          spentTodayUsd,
          remainingTodayUsd: dailyBudgetUsd === null ? null : Math.max(dailyBudgetUsd - spentTodayUsd, 0)
        };
      }
    }
  };
}
