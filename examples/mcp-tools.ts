import { createMemoryReceiptStore } from "safe402";
import { createSafe402McpTools } from "safe402/mcp";

const receipts = createMemoryReceiptStore();

export const safe402Tools = createSafe402McpTools({
  receipts,
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    allowedDomains: ["api.example.com"],
    allowedNetworks: ["base-sepolia"],
    allowedAssets: ["USDC"],
    blockSensitiveMetadata: true
  }
});

const decision = await safe402Tools.safe402_check_payment.handler({
  url: "https://api.example.com/paid-data",
  requirement: {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    payTo: "0x0000000000000000000000000000000000000000",
    maxAmountRequired: "10000",
    resource: "https://api.example.com/paid-data"
  }
});

console.log(decision);
