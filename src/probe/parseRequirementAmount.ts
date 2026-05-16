import type {
  Safe402ParsedAmount,
  Safe402PaymentRequirement,
  Safe402Policy
} from "../types.js";

export const KNOWN_ASSET_DECIMALS: Record<string, number> = {
  usdc: 6,
  "usdc.e": 6,
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": 6
};

export function parseRequirementAmount(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy = {}
): Safe402ParsedAmount {
  const explicitAmountUsd = parseNumber(requirement.amountUsd);
  const maxAmountRequired = scalarToString(requirement.maxAmountRequired);
  const amount = scalarToString(requirement.amount);
  const raw = explicitAmountUsd !== undefined
    ? String(requirement.amountUsd)
    : maxAmountRequired ?? amount;
  const source = explicitAmountUsd !== undefined
    ? "amountUsd"
    : maxAmountRequired !== undefined
      ? "maxAmountRequired"
      : amount !== undefined
        ? "amount"
        : undefined;
  const warnings: string[] = [];

  if (raw === undefined) {
    return {
      valid: false,
      amountUsd: 0,
      raw: undefined,
      reason: "Payment amount is missing.",
      amount,
      maxAmountRequired,
      source,
      decimalsSource: "none",
      warnings
    };
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      valid: false,
      amountUsd: 0,
      raw: undefined,
      reason: "Payment amount is missing.",
      amount,
      maxAmountRequired,
      source,
      decimalsSource: "none",
      warnings
    };
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return {
      valid: false,
      amountUsd: 0,
      raw: trimmed,
      reason: `Payment amount ${trimmed} is invalid.`,
      amount,
      maxAmountRequired,
      source,
      decimalsSource: "none",
      warnings
    };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return {
      valid: false,
      amountUsd: 0,
      raw: trimmed,
      reason: `Payment amount ${trimmed} is invalid.`,
      amount,
      maxAmountRequired,
      source,
      decimalsSource: "none",
      warnings
    };
  }

  if (source === "amountUsd") {
    return {
      valid: true,
      amountUsd: parsed,
      raw: trimmed,
      reason: "Parsed explicit amountUsd.",
      amount,
      maxAmountRequired,
      source,
      decimalsSource: "none",
      atomic: false,
      warnings
    };
  }

  const decimals = resolveAssetDecimals(requirement, policy);
  const isInteger = !trimmed.includes(".");

  if (isInteger && decimals.value !== undefined) {
    return {
      valid: true,
      amountUsd: parsed / 10 ** decimals.value,
      raw: trimmed,
      reason: `Parsed atomic amount with ${decimals.value} decimals.`,
      amount,
      maxAmountRequired,
      source,
      assetDecimals: decimals.value,
      decimalsSource: decimals.source,
      atomic: true,
      warnings
    };
  }

  if (isInteger && decimals.value === undefined) {
    warnings.push("Asset decimals are unclear; parsed integer amount as a decimal USD-style value.");
  }

  return {
    valid: true,
    amountUsd: parsed,
    raw: trimmed,
    reason: "Parsed decimal amount.",
    amount,
    maxAmountRequired,
    source,
    assetDecimals: decimals.value,
    decimalsSource: decimals.source,
    atomic: false,
    warnings
  };
}

export function resolveAssetDecimals(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy = {}
): { value?: number; source: NonNullable<Safe402ParsedAmount["decimalsSource"]> } {
  const asset = typeof requirement.asset === "string" ? requirement.asset.toLowerCase() : undefined;

  if (typeof requirement.assetDecimals === "number") {
    return { value: requirement.assetDecimals, source: "requirement" };
  }

  if (isRecord(requirement.extra) && typeof requirement.extra.decimals === "number") {
    return { value: requirement.extra.decimals, source: "extra" };
  }

  if (typeof requirement.asset === "string" && policy.assetDecimalsByAsset?.[requirement.asset] !== undefined) {
    return { value: policy.assetDecimalsByAsset[requirement.asset], source: "policy" };
  }

  if (asset && policy.assetDecimalsByAsset?.[asset] !== undefined) {
    return { value: policy.assetDecimalsByAsset[asset], source: "policy" };
  }

  if (asset && KNOWN_ASSET_DECIMALS[asset] !== undefined) {
    return { value: KNOWN_ASSET_DECIMALS[asset], source: "known_asset" };
  }

  if (typeof policy.defaultAssetDecimals === "number") {
    return { value: policy.defaultAssetDecimals, source: "policy" };
  }

  return { source: "none" };
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && /^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
