import type {
  Safe402ParsedAmount,
  Safe402PaymentIntentInput,
  Safe402PaymentRequirement,
  Safe402Policy,
  Safe402PrivacyFinding
} from "../types.js";
import { extractPaymentRequirement as extractPaymentRequirementFromProbe } from "../probe/extractRequirement.js";
import { parseRequirementAmount as parseProbeRequirementAmount } from "../probe/parseRequirementAmount.js";
import { findSensitiveStrings } from "./redaction.js";

const KNOWN_ASSET_DECIMALS: Record<string, number> = {
  usdc: 6,
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": 6
};

export async function extractPaymentRequirement(response: Response): Promise<Safe402PaymentRequirement> {
  return extractPaymentRequirementFromProbe(response);
}

export function parseRequirementAmount(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy = {}
): Safe402ParsedAmount {
  return parseProbeRequirementAmount(requirement, policy);
}

export function createPaymentIntentFingerprint(input: Safe402PaymentIntentInput): string {
  const url = toUrl(input.input);
  const method = getRequestMethod(input.input, input.init);
  const body = summarizeRequestBody(input.input, input.init);

  return stableHash({
    method,
    url: normalizeUrl(url),
    body,
    requirement: normalizeRequirementForIntent(input.requirement)
  });
}

export function findSensitivePaymentMetadata(requirement: Safe402PaymentRequirement): Safe402PrivacyFinding[] {
  return findSensitiveStrings(requirement, "paymentRequirement");
}

export function createDuplicateKey(url: URL, requirement: Safe402PaymentRequirement): string {
  return [
    url.origin,
    url.pathname,
    requirement.network ?? "",
    requirement.asset ?? "",
    requirement.payTo ?? "",
    requirement.maxAmountRequired ?? requirement.amount ?? ""
  ].join("|");
}

export function toUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

export function getRequestMethod(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (typeof input === "object" && !(input instanceof URL) && "method" in input && typeof input.method === "string") {
    return input.method.toUpperCase();
  }

  return "GET";
}

export function summarizeRequestBody(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): unknown {
  if (init?.body !== undefined && init.body !== null) {
    return summarizeBodyValue(init.body);
  }

  if (typeof input === "object" && !(input instanceof URL) && "body" in input) {
    return "[request-body-unread]";
  }

  return null;
}

export function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parsePaymentRequirementHeader(header: string | null): Safe402PaymentRequirement | undefined {
  if (!header) {
    return undefined;
  }

  const decoded = decodeBase64Json(header) ?? parseJson(header);

  if (!isRecord(decoded)) {
    return undefined;
  }

  const accepts = decoded.accepts;
  if (Array.isArray(accepts) && accepts.length > 0 && isRecord(accepts[0])) {
    return accepts[0] as Safe402PaymentRequirement;
  }

  return decoded as Safe402PaymentRequirement;
}

function decodeBase64Json(value: string): unknown {
  try {
    return parseJson(globalThis.atob(value));
  } catch {
    return undefined;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function resolveAssetDecimals(requirement: Safe402PaymentRequirement, policy: Safe402Policy): number | undefined {
  const asset = requirement.asset?.toLowerCase();

  if (requirement.asset && policy.assetDecimalsByAsset?.[requirement.asset] !== undefined) {
    return policy.assetDecimalsByAsset[requirement.asset];
  }

  if (asset && policy.assetDecimalsByAsset?.[asset] !== undefined) {
    return policy.assetDecimalsByAsset[asset];
  }

  if (typeof requirement.assetDecimals === "number") {
    return requirement.assetDecimals;
  }

  if (isRecord(requirement.extra) && typeof requirement.extra.decimals === "number") {
    return requirement.extra.decimals;
  }

  if (asset && KNOWN_ASSET_DECIMALS[asset] !== undefined) {
    return KNOWN_ASSET_DECIMALS[asset];
  }

  return policy.defaultAssetDecimals;
}

function summarizeBodyValue(body: BodyInit): unknown {
  if (typeof body === "string") {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof Blob) {
    return {
      type: "blob",
      size: body.size,
      mimeType: body.type
    };
  }

  if (body instanceof FormData) {
    return {
      type: "form-data",
      fields: Array.from(body.keys()).sort()
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      type: "array-buffer",
      byteLength: body.byteLength
    };
  }

  if (ArrayBuffer.isView(body)) {
    return {
      type: "array-buffer-view",
      byteLength: body.byteLength
    };
  }

  return `[${Object.prototype.toString.call(body)}]`;
}

export function normalizeUrl(url: URL): string {
  const normalized = new URL(url.href);
  normalized.hash = "";
  return normalized.href;
}

function normalizeRequirementForIntent(requirement: Safe402PaymentRequirement | undefined): Record<string, unknown> | undefined {
  if (!requirement) {
    return undefined;
  }

  return {
    scheme: requirement.scheme,
    network: requirement.network,
    asset: requirement.asset,
    payTo: requirement.payTo,
    maxAmountRequired: requirement.maxAmountRequired,
    amount: requirement.amount,
    resource: requirement.resource,
    description: requirement.description,
    mimeType: requirement.mimeType
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function includesNormalized(values: string[] | undefined, value: string): boolean {
  return values?.some(item => item.toLowerCase() === value.toLowerCase()) ?? false;
}
