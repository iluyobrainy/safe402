import {
  AUDIT_HOSTED_REPORT_USD,
  AUDIT_MCP_SERVER_SCAN_USD,
  AUDIT_MINIMUM_USD,
  AUDIT_PRICING_USD,
  AUDIT_REQUEST_VARIANT_USD,
  calculateAuditProfilePrice,
  formatUsd
} from "../pricing.js";

export type Safe402AuditProfile = "basic" | "standard" | "deep" | "custom";

export type Safe402AuditQuoteOptions = {
  profile?: Safe402AuditProfile;
  endpoints?: string[];
  requestVariants?: number;
  mcpServers?: number;
  hostedReport?: boolean;
  customCases?: number;
};

export type Safe402AuditQuoteLineItem = {
  label: string;
  unitUsd?: number;
  quantity: number;
  totalUsd?: number;
};

export type Safe402AuditQuote = {
  kind: "audit_quote";
  profile: Safe402AuditProfile;
  quoteBased: boolean;
  endpointsCount: number;
  requestVariantsCount: number;
  mcpScanEnabled: boolean;
  mcpServersCount: number;
  hostedReportEnabled: boolean;
  totalUsd: number;
  minimumUsd: number;
  priceBreakdown: Safe402AuditQuoteLineItem[];
  includedChecks: string[];
  warnings: string[];
  note: string;
};

export const BASIC_AUDIT_CHECKS = [
  "full probe",
  "valid 402 challenge structure",
  "multiple accepts handling",
  "policy decision",
  "human-readable price vs machine-readable amount mismatch",
  "asset decimals ambiguity check",
  "unsupported chain and unsupported asset check",
  "unexpected payTo check",
  "metadata privacy check for descriptions, resources, reasons, API keys, and wallet-linked data",
  "basic Markdown and JSON report"
];

export const STANDARD_AUDIT_CHECKS = [
  ...BASIC_AUDIT_CHECKS,
  "repeated challenge stability test",
  "payTo mutation check",
  "amount mutation check",
  "resource mutation check",
  "method and body mutation risk",
  "duplicate retry simulation",
  "retry-loop dry-run",
  "payment intent fingerprint analysis for method, URL, body hash, amount, network, asset, payTo, and agentTaskId",
  "idempotency and payment-identifier check",
  "missing PAYMENT-RESPONSE and X-PAYMENT-RESPONSE handling",
  "deeper report with recommended fixes"
];

export const DEEP_AUDIT_CHECKS = [
  ...STANDARD_AUDIT_CHECKS,
  "multiple request-body variants",
  "MCP manifest and tool checks if MCP config is provided",
  "facilitator risk checks",
  "paid-but-denied risk analysis",
  "unpaid-service risk analysis",
  "settlement proof and suspicious facilitator URL checks",
  "CI-grade full report",
  "generated remediation checklist"
];

const CUSTOM_AUDIT_CHECKS = [
  "custom scope review",
  "authenticated or sandbox payment-flow planning",
  "manual review estimate",
  "quote-based remediation plan"
];

export function quoteAudit(options: Safe402AuditQuoteOptions = {}): Safe402AuditQuote {
  const profile = options.profile ?? "basic";
  const endpointsCount = options.endpoints?.length ?? 0;
  const billableEndpoints = Math.max(endpointsCount, profile === "custom" ? 0 : 1);
  const requestVariantsCount = Math.max(0, options.requestVariants ?? 0);
  const mcpServersCount = Math.max(0, options.mcpServers ?? 0);
  const hostedReportEnabled = options.hostedReport ?? false;
  const warnings = quoteWarnings(profile, endpointsCount, mcpServersCount);

  if (profile === "custom") {
    return {
      kind: "audit_quote",
      profile,
      quoteBased: true,
      endpointsCount,
      requestVariantsCount,
      mcpScanEnabled: mcpServersCount > 0,
      mcpServersCount,
      hostedReportEnabled,
      totalUsd: 0,
      minimumUsd: AUDIT_MINIMUM_USD,
      priceBreakdown: [{
        label: "Custom audit",
        quantity: 1
      }],
      includedChecks: CUSTOM_AUDIT_CHECKS,
      warnings: [
        ...warnings,
        "Custom audits are quote-based because the scope needs manual confirmation before billing."
      ],
      note: "Custom Safe402 audits are quote-based and should be priced before any paid work starts."
    };
  }

  const profileTotal = calculateAuditProfilePrice(profile, billableEndpoints);
  const variantTotal = AUDIT_REQUEST_VARIANT_USD * requestVariantsCount;
  const mcpTotal = AUDIT_MCP_SERVER_SCAN_USD * mcpServersCount;
  const hostedReportTotal = hostedReportEnabled ? AUDIT_HOSTED_REPORT_USD : 0;
  const subtotal = profileTotal + variantTotal + mcpTotal + hostedReportTotal;
  const minimumAdjustment = Math.max(0, AUDIT_MINIMUM_USD - subtotal);
  const totalUsd = subtotal + minimumAdjustment;
  const priceBreakdown: Safe402AuditQuoteLineItem[] = [
    {
      label: `${profile} audit endpoint${billableEndpoints === 1 ? "" : "s"}`,
      unitUsd: AUDIT_PRICING_USD[profile],
      quantity: billableEndpoints,
      totalUsd: profileTotal
    }
  ];

  if (requestVariantsCount > 0) {
    priceBreakdown.push({
      label: "additional request variant",
      unitUsd: AUDIT_REQUEST_VARIANT_USD,
      quantity: requestVariantsCount,
      totalUsd: variantTotal
    });
  }

  if (mcpServersCount > 0) {
    priceBreakdown.push({
      label: "MCP tool manifest scan",
      unitUsd: AUDIT_MCP_SERVER_SCAN_USD,
      quantity: mcpServersCount,
      totalUsd: mcpTotal
    });
  }

  if (hostedReportEnabled) {
    priceBreakdown.push({
      label: "CI signed hosted report",
      unitUsd: AUDIT_HOSTED_REPORT_USD,
      quantity: 1,
      totalUsd: hostedReportTotal
    });
  }

  if (minimumAdjustment > 0) {
    priceBreakdown.push({
      label: "minimum audit charge adjustment",
      quantity: 1,
      totalUsd: minimumAdjustment
    });
  }

  return {
    kind: "audit_quote",
    profile,
    quoteBased: false,
    endpointsCount,
    requestVariantsCount,
    mcpScanEnabled: mcpServersCount > 0,
    mcpServersCount,
    hostedReportEnabled,
    totalUsd,
    minimumUsd: AUDIT_MINIMUM_USD,
    priceBreakdown,
    includedChecks: includedChecksForProfile(profile),
    warnings,
    note: "Safe402 calculates the audit quote before running checks. Extra scope discovered later must return ADDITIONAL_PAYMENT_REQUIRED instead of silently overcharging."
  };
}

export function formatAuditQuote(quote: Safe402AuditQuote): string {
  const total = quote.quoteBased ? "quote-based" : formatUsd(quote.totalUsd);
  const lines = [
    "Safe402 audit quote",
    `Profile: ${quote.profile}`,
    `Endpoints: ${quote.endpointsCount}`,
    `Request variants: ${quote.requestVariantsCount}`,
    `MCP scan: ${quote.mcpScanEnabled ? `yes (${quote.mcpServersCount})` : "no"}`,
    `Hosted report: ${quote.hostedReportEnabled ? "yes" : "no"}`,
    `Total: ${total}`,
    "",
    "Price breakdown:"
  ];

  for (const item of quote.priceBreakdown) {
    const unit = item.unitUsd === undefined ? "" : ` @ ${formatUsd(item.unitUsd)}`;
    const itemTotal = item.totalUsd === undefined ? "quote-based" : formatUsd(item.totalUsd);
    lines.push(`- ${item.label}: ${item.quantity}${unit} = ${itemTotal}`);
  }

  lines.push("", "Included checks:");
  lines.push(...quote.includedChecks.map(check => `- ${check}`));

  if (quote.warnings.length > 0) {
    lines.push("", "Notes:");
    lines.push(...quote.warnings.map(warning => `- ${warning}`));
  }

  return lines.join("\n");
}

export function includedChecksForProfile(profile: Safe402AuditProfile): string[] {
  if (profile === "basic") {
    return BASIC_AUDIT_CHECKS;
  }

  if (profile === "standard") {
    return STANDARD_AUDIT_CHECKS;
  }

  if (profile === "deep") {
    return DEEP_AUDIT_CHECKS;
  }

  return CUSTOM_AUDIT_CHECKS;
}

function quoteWarnings(
  profile: Safe402AuditProfile,
  endpointsCount: number,
  mcpServersCount: number
): string[] {
  const warnings: string[] = [];

  if (endpointsCount > 10 && profile !== "custom") {
    warnings.push("Large endpoint sets may need custom quote review before hosted or manual audit work.");
  }

  if (mcpServersCount > 0 && profile !== "deep" && profile !== "custom") {
    warnings.push("MCP manifest scans are priced as add-ons; deep profile is recommended for full MCP tool review.");
  }

  return warnings;
}
