import type { Safe402ParsedAmount, Safe402PaymentRequirement, Safe402Policy } from "../types.js";
import type { Safe402ExtractedRequirement, Safe402RequirementSource } from "./extractRequirement.js";
import { parseRequirementAmount } from "./parseRequirementAmount.js";

export type Safe402NormalizedPaymentRequirement = Safe402PaymentRequirement & {
  source: Safe402RequirementSource;
  optionIndex: number;
  raw: Safe402PaymentRequirement;
  amount?: string;
  amountUsd: number;
  maxAmountRequired?: string;
  asset?: string;
  assetDecimals?: number;
  network?: string;
  chain?: string;
  payTo?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  scheme?: string;
  facilitator?: string;
  expiresAt?: string;
  ttlSeconds?: number;
  extra: Record<string, unknown>;
};

export type Safe402ProbePaymentOption = {
  index: number;
  source: Safe402RequirementSource;
  requirement: Safe402NormalizedPaymentRequirement;
  parsedAmount: Safe402ParsedAmount;
};

export function normalizeAcceptOptions(
  requirements: Safe402ExtractedRequirement[],
  policy: Safe402Policy = {}
): Safe402ProbePaymentOption[] {
  return requirements.map((item, index) => {
    const requirement = normalizeRequirement(item.requirement, item.source, index, policy);

    return {
      index,
      source: item.source,
      requirement,
      parsedAmount: parseRequirementAmount(requirement, policy)
    };
  });
}

export function chooseBestCompatibleOption<T extends {
  option: Safe402ProbePaymentOption;
  category: "APPROVED" | "NEEDS_APPROVAL" | "BLOCKED_BY_POLICY" | "SUSPICIOUS" | "INVALID_X402" | "FREE_OR_NOT_GATED" | "UNREACHABLE";
  amountUsd: number;
}>(options: T[]): T | undefined {
  const rank = new Map<T["category"], number>([
    ["APPROVED", 0],
    ["NEEDS_APPROVAL", 1],
    ["SUSPICIOUS", 2],
    ["BLOCKED_BY_POLICY", 3],
    ["INVALID_X402", 4],
    ["FREE_OR_NOT_GATED", 5],
    ["UNREACHABLE", 6]
  ]);

  return [...options].sort((left, right) => {
    const categoryDelta = (rank.get(left.category) ?? 99) - (rank.get(right.category) ?? 99);
    if (categoryDelta !== 0) {
      return categoryDelta;
    }

    return left.amountUsd - right.amountUsd;
  })[0];
}

function normalizeRequirement(
  raw: Safe402PaymentRequirement,
  source: Safe402RequirementSource,
  optionIndex: number,
  policy: Safe402Policy
): Safe402NormalizedPaymentRequirement {
  const network = stringValue(raw.network ?? raw.chain ?? raw.chainId);
  const chain = stringValue(raw.chain ?? raw.chainId ?? raw.network);
  const asset = stringValue(raw.asset ?? raw.token ?? raw.currency);
  const payTo = stringValue(raw.payTo ?? raw.payee ?? raw.recipient ?? raw.to);
  const maxAmountRequired = scalarToString(raw.maxAmountRequired ?? raw.max_amount_required ?? raw.maxAmount);
  const amount = scalarToString(raw.amount ?? raw.price);
  const amountUsd = parseRequirementAmount({
    ...raw,
    network,
    chain,
    asset,
    payTo,
    maxAmountRequired,
    amount,
    assetDecimals: numberValue(raw.assetDecimals ?? raw.decimals)
  }, policy).amountUsd;
  const assetDecimals = numberValue(raw.assetDecimals ?? raw.decimals);
  const facilitator = facilitatorValue(raw.facilitator ?? raw.facilitatorUrl ?? raw.facilitatorURL);
  const expiresAt = dateString(raw.expiresAt ?? raw.expires_at ?? raw.expiration);
  const ttlSeconds = numberValue(raw.ttlSeconds ?? raw.ttl ?? raw.maxTimeoutSeconds);

  return {
    ...raw,
    source,
    optionIndex,
    raw,
    scheme: stringValue(raw.scheme),
    network,
    chain,
    asset,
    assetDecimals,
    payTo,
    maxAmountRequired,
    amount,
    amountUsd,
    resource: stringValue(raw.resource ?? raw.url),
    description: stringValue(raw.description ?? raw.reason),
    mimeType: stringValue(raw.mimeType ?? raw.mime_type ?? raw.contentType),
    facilitator,
    expiresAt,
    ttlSeconds,
    extra: {
      ...collectExtra(raw),
      ...(isRecord(raw.extra) ? raw.extra : {})
    }
  };
}

function collectExtra(raw: Safe402PaymentRequirement): Record<string, unknown> {
  const known = new Set([
    "scheme",
    "network",
    "chain",
    "chainId",
    "asset",
    "token",
    "currency",
    "assetDecimals",
    "decimals",
    "payTo",
    "payee",
    "recipient",
    "to",
    "maxAmountRequired",
    "max_amount_required",
    "maxAmount",
    "amount",
    "amountUsd",
    "price",
    "resource",
    "url",
    "description",
    "reason",
    "mimeType",
    "mime_type",
    "contentType",
    "facilitator",
    "facilitatorUrl",
    "facilitatorURL",
    "expiresAt",
    "expires_at",
    "expiration",
    "ttlSeconds",
    "ttl",
    "maxTimeoutSeconds",
    "extra"
  ]);
  const extra: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) {
      extra[key] = value;
    }
  }

  return extra;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
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

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function facilitatorValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringValue(value);
  }

  if (isRecord(value)) {
    return stringValue(value.url ?? value.endpoint ?? value.name);
  }

  return undefined;
}

function dateString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
