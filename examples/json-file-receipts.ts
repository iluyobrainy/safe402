import { createSafe402Fetch } from "safe402";
import { createJsonFileReceiptStore } from "safe402/node";

const receipts = createJsonFileReceiptStore({
  path: ".safe402/receipts.json"
});

const safeFetch = createSafe402Fetch({
  paidFetch: fetch,
  receipts,
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    blockPaymentIntentChanges: true,
    duplicateWindowMs: 30 * 60 * 1000
  }
});

const response = await safeFetch("https://api.example.com/paid-data");
console.log(response.status);
