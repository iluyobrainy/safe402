import {
  PROBE_PRICE_USD,
  calculateProbePrice,
  formatUsd
} from "../pricing.js";
import type { Safe402AuditProfile } from "../audit/quote.js";
import type {
  Safe402BillingQuote,
  Safe402BillingQuoteLineItem
} from "./types.js";

export type ProbeQuoteInput = {
  endpointChecks?: number;
};

export type AuditQuoteLike = {
  profile: Safe402AuditProfile;
  quoteBased: boolean;
  endpointsCount: number;
  requestVariantsCount: number;
  mcpScanEnabled: boolean;
  mcpServersCount: number;
  hostedReportEnabled: boolean;
  totalUsd: number;
  priceBreakdown: Safe402BillingQuoteLineItem[];
  includedChecks: string[];
};

export class ProbeQuoteEngine {
  quote(input: ProbeQuoteInput = {}): Safe402BillingQuote {
    const endpointChecks = Math.max(1, input.endpointChecks ?? 1);
    const totalUsd = calculateProbePrice(endpointChecks);

    return {
      kind: "billing_quote",
      id: `probe-${endpointChecks}-${totalUsd.toFixed(2)}`,
      product: "probe",
      description: `Safe402 Probe for ${endpointChecks} endpoint${endpointChecks === 1 ? "" : "s"}`,
      currency: "USD",
      totalUsd,
      priceBreakdown: [{
        label: "probe endpoint check",
        unitUsd: PROBE_PRICE_USD,
        quantity: endpointChecks,
        totalUsd
      }],
      metadata: {
        endpointChecks,
        unitPriceUsd: PROBE_PRICE_USD,
        includedChecks: [
          "unpaid endpoint request",
          "402 payment challenge capture",
          "all accepts options evaluation",
          "policy evaluation",
          "amount ambiguity detection",
          "metadata privacy scan"
        ]
      }
    };
  }
}

export class AuditQuoteEngine {
  quote(input: AuditQuoteLike): Safe402BillingQuote {
    const total = input.quoteBased ? "quote-based" : formatUsd(input.totalUsd);

    return {
      kind: "billing_quote",
      id: `audit-${input.profile}-${input.endpointsCount}-${input.totalUsd.toFixed(2)}`,
      product: "audit",
      description: `Safe402 ${input.profile} audit quote (${total})`,
      currency: "USD",
      totalUsd: input.totalUsd,
      priceBreakdown: input.priceBreakdown.map(item => ({ ...item })),
      metadata: {
        profile: input.profile,
        quoteBased: input.quoteBased,
        endpointsCount: input.endpointsCount,
        requestVariantsCount: input.requestVariantsCount,
        mcpScanEnabled: input.mcpScanEnabled,
        mcpServersCount: input.mcpServersCount,
        hostedReportEnabled: input.hostedReportEnabled,
        includedChecks: [...input.includedChecks]
      }
    };
  }
}

export const probeQuoteEngine = new ProbeQuoteEngine();
export const auditQuoteEngine = new AuditQuoteEngine();

export function quoteProbeBilling(input: ProbeQuoteInput = {}): Safe402BillingQuote {
  return probeQuoteEngine.quote(input);
}

export function quoteAuditBilling(input: AuditQuoteLike): Safe402BillingQuote {
  return auditQuoteEngine.quote(input);
}
