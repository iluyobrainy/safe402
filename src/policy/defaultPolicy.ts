import {
  DEFAULT_DUPLICATE_WINDOW_MS,
  DEFAULT_PAID_DENIAL_STATUS_CODES
} from "../billing/index.js";
import type { Safe402Policy } from "../types.js";

export const defaultPolicy: Safe402Policy = {
  blockPaymentIntentChanges: true,
  duplicateWindowMs: DEFAULT_DUPLICATE_WINDOW_MS,
  failOnPaidStatusCodes: DEFAULT_PAID_DENIAL_STATUS_CODES
};
