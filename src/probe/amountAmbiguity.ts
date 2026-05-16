import type {
  Safe402ParsedAmount,
  Safe402PaymentRequirement,
  Safe402Policy
} from "../types.js";

export type Safe402AmountAmbiguityCode =
  | "description_price_mismatch"
  | "amount_field_mismatch"
  | "asset_decimals_unclear"
  | "suspiciously_low_amount"
  | "suspiciously_high_amount";

export type Safe402AmountAmbiguityFinding = {
  code: Safe402AmountAmbiguityCode;
  severity: "warning" | "suspicious";
  message: string;
  expectedAmountUsd?: number;
  observedAmountUsd?: number;
};

export function detectAmountAmbiguity(input: {
  requirement: Safe402PaymentRequirement;
  parsedAmount: Safe402ParsedAmount;
  policy?: Safe402Policy;
}): Safe402AmountAmbiguityFinding[] {
  const findings: Safe402AmountAmbiguityFinding[] = [];
  const { requirement, parsedAmount, policy = {} } = input;

  if (!parsedAmount.valid) {
    return findings;
  }

  const textPrice = findHumanPrice(requirement);
  if (textPrice !== undefined && differs(textPrice, parsedAmount.amountUsd)) {
    findings.push({
      code: "description_price_mismatch",
      severity: "suspicious",
      message: `Human-readable payment text mentions $${formatAmount(textPrice)}, but the machine-readable amount implies $${formatAmount(parsedAmount.amountUsd)}.`,
      expectedAmountUsd: textPrice,
      observedAmountUsd: parsedAmount.amountUsd
    });
  }

  const amountUsd = parseNumber(requirement.amountUsd);
  if (amountUsd !== undefined && differs(amountUsd, parsedAmount.amountUsd)) {
    findings.push({
      code: "amount_field_mismatch",
      severity: "suspicious",
      message: `amountUsd is $${formatAmount(amountUsd)}, but maxAmountRequired/amount implies $${formatAmount(parsedAmount.amountUsd)}.`,
      expectedAmountUsd: amountUsd,
      observedAmountUsd: parsedAmount.amountUsd
    });
  }

  if (parsedAmount.decimalsSource === "none" && parsedAmount.raw && !parsedAmount.raw.includes(".") && Number(parsedAmount.raw) >= 1000) {
    findings.push({
      code: "asset_decimals_unclear",
      severity: "suspicious",
      message: "Asset decimals are unclear for an integer payment amount, so the USD estimate may be wrong.",
      observedAmountUsd: parsedAmount.amountUsd
    });
  }

  if (parsedAmount.amountUsd > 0 && parsedAmount.amountUsd < 0.000001) {
    findings.push({
      code: "suspiciously_low_amount",
      severity: "warning",
      message: `Payment amount $${formatAmount(parsedAmount.amountUsd)} is suspiciously low and may indicate decimal confusion.`,
      observedAmountUsd: parsedAmount.amountUsd
    });
  }

  const highWatermark = policy.maxPaymentUsd !== undefined
    ? Math.max(policy.maxPaymentUsd * 100, 100)
    : 10_000;

  if (parsedAmount.amountUsd > highWatermark) {
    findings.push({
      code: "suspiciously_high_amount",
      severity: "suspicious",
      message: `Payment amount $${formatAmount(parsedAmount.amountUsd)} is suspiciously high for a pre-payment probe.`,
      observedAmountUsd: parsedAmount.amountUsd
    });
  }

  return findings;
}

function findHumanPrice(requirement: Safe402PaymentRequirement): number | undefined {
  const candidates = [
    requirement.description,
    requirement.resource,
    typeof requirement.extra?.description === "string" ? requirement.extra.description : undefined,
    typeof requirement.extra?.reason === "string" ? requirement.extra.reason : undefined
  ].filter((value): value is string => typeof value === "string");

  for (const candidate of candidates) {
    const price = extractPrice(candidate);
    if (price !== undefined) {
      return price;
    }
  }

  return undefined;
}

function extractPrice(value: string): number | undefined {
  const patterns = [
    /\$\s*(\d+(?:\.\d+)?)/i,
    /\bUSD\s*(\d+(?:\.\d+)?)/i,
    /\b(\d+(?:\.\d+)?)\s*(?:USD|USDC)\b/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) {
      return parseNumber(match[1]);
    }
  }

  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function differs(left: number, right: number): boolean {
  const tolerance = Math.max(Math.abs(left) * 0.01, 0.000001);
  return Math.abs(left - right) > tolerance;
}

function formatAmount(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toPrecision(6).replace(/0+$/, "").replace(/\.$/, "");
}
