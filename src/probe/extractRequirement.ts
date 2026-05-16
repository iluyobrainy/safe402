import type { Safe402PaymentRequirement } from "../types.js";
import { collectCandidateObjects, readResponseBody, type Safe402ResponseBodySnapshot } from "../utils/body.js";
import {
  getHeader,
  headersToObject,
  parseHeaderValueCandidates,
  parseWwwAuthenticateParameters,
  type Safe402HeaderMap
} from "../utils/headers.js";

export type Safe402RequirementSource =
  | "PAYMENT-REQUIRED"
  | "X-PAYMENT-REQUIRED"
  | "WWW-Authenticate"
  | "body";

export type Safe402ExtractedRequirement = {
  source: Safe402RequirementSource;
  requirement: Safe402PaymentRequirement;
  optionIndex: number;
};

export type Safe402RequirementExtraction = {
  responseStatus: number;
  headers: Safe402HeaderMap;
  body: Safe402ResponseBodySnapshot;
  requirements: Safe402ExtractedRequirement[];
  invalidReasons: string[];
};

export async function extractPaymentRequirements(response: Response): Promise<Safe402RequirementExtraction> {
  const body = await readResponseBody(response);
  const headers = headersToObject(response.headers);
  const requirements: Safe402ExtractedRequirement[] = [];
  const invalidReasons: string[] = [];

  collectHeaderRequirements(response.headers, requirements, invalidReasons);
  collectBodyRequirements(body.json, requirements);

  return {
    responseStatus: response.status,
    headers,
    body,
    requirements: dedupeRequirements(requirements),
    invalidReasons
  };
}

export async function extractPaymentRequirement(response: Response): Promise<Safe402PaymentRequirement> {
  const extraction = await extractPaymentRequirements(response);
  return extraction.requirements[0]?.requirement ?? {};
}

function collectHeaderRequirements(
  headers: Headers,
  requirements: Safe402ExtractedRequirement[],
  invalidReasons: string[]
) {
  for (const source of ["PAYMENT-REQUIRED", "X-PAYMENT-REQUIRED"] as const) {
    const value = getHeader(headers, [source]);
    if (!value) {
      continue;
    }

    const before = requirements.length;
    for (const candidate of parseHeaderValueCandidates(value)) {
      collectRequirements(candidate, source, requirements);
    }

    if (requirements.length === before) {
      invalidReasons.push(`${source} header did not contain a usable x402 payment requirement.`);
    }
  }

  const authenticate = getHeader(headers, ["WWW-Authenticate"]);
  if (!authenticate) {
    return;
  }

  const before = requirements.length;
  for (const candidate of parseHeaderValueCandidates(authenticate)) {
    collectRequirements(candidate, "WWW-Authenticate", requirements);
  }

  const params = parseWwwAuthenticateParameters(authenticate);
  for (const key of ["payment-required", "payment_required", "requirement", "accepts", "x402"]) {
    for (const candidate of parseHeaderValueCandidates(params[key] ?? null)) {
      collectRequirements(candidate, "WWW-Authenticate", requirements);
    }
  }

  if (requirements.length === before && /\bx402\b/i.test(authenticate)) {
    invalidReasons.push("WWW-Authenticate mentioned x402 but did not contain a usable payment requirement.");
  }
}

function collectBodyRequirements(body: unknown, requirements: Safe402ExtractedRequirement[]) {
  if (body === undefined) {
    return;
  }

  for (const candidate of collectCandidateObjects(body)) {
    collectRequirements(candidate, "body", requirements);
  }
}

function collectRequirements(
  candidate: unknown,
  source: Safe402RequirementSource,
  requirements: Safe402ExtractedRequirement[]
) {
  if (!isRecord(candidate)) {
    return;
  }

  const accepts = candidate.accepts;
  if (Array.isArray(accepts)) {
    accepts.forEach((item, index) => {
      if (isRecord(item)) {
        requirements.push({
          source,
          requirement: item as Safe402PaymentRequirement,
          optionIndex: index
        });
      }
    });
  }

  for (const key of ["paymentRequirements", "payment_requirements", "requirements"]) {
    const nested = candidate[key];
    if (Array.isArray(nested)) {
      nested.forEach((item, index) => {
        if (isRecord(item)) {
          requirements.push({
            source,
            requirement: item as Safe402PaymentRequirement,
            optionIndex: index
          });
        }
      });
    }
  }

  for (const key of ["paymentRequirement", "payment_requirement", "requirement", "x402"]) {
    const nested = candidate[key];
    if (isRecord(nested)) {
      collectRequirements(nested, source, requirements);
      if (isPaymentRequirementLike(nested)) {
        requirements.push({
          source,
          requirement: nested as Safe402PaymentRequirement,
          optionIndex: requirements.length
        });
      }
    }
  }

  if (isPaymentRequirementLike(candidate)) {
    requirements.push({
      source,
      requirement: candidate as Safe402PaymentRequirement,
      optionIndex: requirements.length
    });
  }
}

function isPaymentRequirementLike(value: Record<string, unknown>): boolean {
  return [
    "scheme",
    "network",
    "chain",
    "asset",
    "payTo",
    "recipient",
    "maxAmountRequired",
    "amount",
    "amountUsd",
    "resource",
    "facilitator"
  ].some(key => value[key] !== undefined);
}

function dedupeRequirements(requirements: Safe402ExtractedRequirement[]): Safe402ExtractedRequirement[] {
  const seen = new Set<string>();
  const output: Safe402ExtractedRequirement[] = [];

  for (const item of requirements) {
    const key = stableStringify(item.requirement);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({
      ...item,
      optionIndex: output.length
    });
  }

  return output;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
