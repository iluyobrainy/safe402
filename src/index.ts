export type Safe402DecisionStatus =
  | "approved"
  | "denied"
  | "approval_required"
  | "paid"
  | "failed"
  | "free";

export type Safe402PaymentRequirement = {
  scheme?: string;
  network?: string;
  asset?: string;
  assetDecimals?: number;
  payTo?: string;
  maxAmountRequired?: string;
  amount?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
};

export type Safe402Policy = {
  maxPaymentUsd?: number;
  dailyBudgetUsd?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedNetworks?: string[];
  allowedAssets?: string[];
  allowedPayTo?: string[];
  assetDecimalsByAsset?: Record<string, number>;
  defaultAssetDecimals?: number;
  blockSensitiveMetadata?: boolean;
  blockPaymentIntentChanges?: boolean;
  requirePaymentResponseHeader?: boolean;
  failOnPaidStatusCodes?: number[];
  requireApprovalAboveUsd?: number;
  duplicateWindowMs?: number;
};

export type Safe402Decision = {
  status: Safe402DecisionStatus;
  reason: string;
  url: string;
  domain: string;
  amountUsd: number;
  requirement?: Safe402PaymentRequirement;
  paymentIntent?: string;
  duplicateKey?: string;
  timestamp: string;
};

export type Safe402Receipt = Safe402Decision & {
  responseStatus?: number;
  paymentResponse?: string | null;
};

export type Safe402ReceiptStore = {
  list(): Promise<Safe402Receipt[]>;
  save(receipt: Safe402Receipt): Promise<void>;
};

export type Safe402FetchConfig = {
  fetch?: typeof fetch;
  paidFetch: typeof fetch;
  policy?: Safe402Policy;
  receipts?: Safe402ReceiptStore;
  onDecision?: (decision: Safe402Decision) => void | Promise<void>;
  onApprovalRequired?: (decision: Safe402Decision) => boolean | Promise<boolean>;
};

const DEFAULT_DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_PAID_DENIAL_STATUS_CODES = [401, 403];
const KNOWN_ASSET_DECIMALS: Record<string, number> = {
  usdc: 6,
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": 6
};

export class Safe402Error extends Error {
  decision: Safe402Decision;

  constructor(decision: Safe402Decision) {
    super(decision.reason);
    this.name = "Safe402Error";
    this.decision = decision;
  }
}

export function createMemoryReceiptStore(initialReceipts: Safe402Receipt[] = []): Safe402ReceiptStore {
  const receipts = [...initialReceipts];

  return {
    async list() {
      return [...receipts];
    },
    async save(receipt) {
      receipts.push(receipt);
    }
  };
}

export function createSafe402Fetch(config: Safe402FetchConfig): typeof fetch {
  const rawFetch = config.fetch ?? globalThis.fetch;
  const receipts = config.receipts ?? createMemoryReceiptStore();

  return async (input, init) => {
    const url = toUrl(input);
    const policy = config.policy ?? {};
    const requestIntentBeforeChallenge = createRequestIntentFingerprint(input, init);
    const firstResponse = await rawFetch(input, init);

    if (firstResponse.status !== 402) {
      await record(receipts, config, {
        status: "free",
        reason: "No x402 payment was required.",
        url: url.href,
        domain: url.hostname,
        amountUsd: 0,
        timestamp: new Date().toISOString()
      }, firstResponse);
      return firstResponse;
    }

    const requirement = await extractPaymentRequirement(firstResponse);
    const paymentIntent = createPaymentIntentFingerprint({ input, init, requirement });
    const decision = await evaluatePayment({
      url,
      requirement,
      policy,
      receipts,
      paymentIntent
    });

    if (decision.status === "approval_required") {
      const approved = await config.onApprovalRequired?.(decision);
      if (!approved) {
        const denied = { ...decision, status: "denied" as const, reason: "Human approval was required and not granted." };
        await record(receipts, config, denied);
        throw new Safe402Error(denied);
      }
    } else if (decision.status === "denied") {
      await record(receipts, config, decision);
      throw new Safe402Error(decision);
    }

    const requestIntentBeforePayment = createRequestIntentFingerprint(input, init);
    if (policy.blockPaymentIntentChanges !== false && requestIntentBeforeChallenge !== requestIntentBeforePayment) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: "Request intent changed between the 402 challenge and paid retry.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision);
      throw new Safe402Error(failedDecision);
    }

    let paidResponse: Response;
    try {
      paidResponse = await config.paidFetch(input, init);
    } catch (error) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: error instanceof Error ? `Paid fetch failed: ${error.message}` : "Paid fetch failed.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision);
      throw new Safe402Error(failedDecision);
    }

    if (paidResponse.status === 402) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: "Paid fetch returned another 402; retry fuse stopped to avoid a payment loop.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision, paidResponse);
      throw new Safe402Error(failedDecision);
    }

    const paymentResponse = getPaymentResponseHeader(paidResponse);
    if (policy.requirePaymentResponseHeader && !paymentResponse) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: "Paid response is missing PAYMENT-RESPONSE header.",
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision, paidResponse);
      throw new Safe402Error(failedDecision);
    }

    const paidDenialCodes = policy.failOnPaidStatusCodes ?? DEFAULT_PAID_DENIAL_STATUS_CODES;
    if (paidDenialCodes.includes(paidResponse.status)) {
      const failedDecision: Safe402Decision = {
        ...decision,
        status: "failed",
        reason: `Paid response returned ${paidResponse.status}; possible paid-but-denied flow.`,
        timestamp: new Date().toISOString()
      };
      await record(receipts, config, failedDecision, paidResponse);
      throw new Safe402Error(failedDecision);
    }

    const paidDecision: Safe402Decision = {
      ...decision,
      status: "paid",
      reason: "Payment passed Safe402 policy and paid fetch completed.",
      timestamp: new Date().toISOString()
    };

    await record(receipts, config, paidDecision, paidResponse);
    return paidResponse;
  };
}

export async function evaluatePayment(input: {
  url: URL;
  requirement: Safe402PaymentRequirement;
  policy: Safe402Policy;
  receipts: Safe402ReceiptStore;
  paymentIntent?: string;
}): Promise<Safe402Decision> {
  const { url, requirement, policy, receipts, paymentIntent } = input;
  const parsedAmount = parseRequirementAmount(requirement, policy);
  const amountUsd = parsedAmount.amountUsd;
  const domain = url.hostname.toLowerCase();
  const timestamp = new Date().toISOString();
  const duplicateKey = createDuplicateKey(url, requirement);

  const baseDecision = {
    url: url.href,
    domain,
    amountUsd,
    requirement,
    paymentIntent,
    duplicateKey,
    timestamp
  };

  if (!parsedAmount.valid) {
    return { ...baseDecision, status: "denied", reason: parsedAmount.reason };
  }

  if (amountUsd <= 0) {
    return { ...baseDecision, status: "denied", reason: "Payment amount must be greater than zero." };
  }

  if (includesNormalized(policy.blockedDomains, domain)) {
    return { ...baseDecision, status: "denied", reason: `Domain ${domain} is blocked.` };
  }

  const privacyFindings = findSensitivePaymentMetadata(requirement);
  if (policy.blockSensitiveMetadata && privacyFindings.length > 0) {
    return { ...baseDecision, status: "denied", reason: `Sensitive metadata detected: ${privacyFindings.map(finding => finding.type).join(", ")}.` };
  }

  if (policy.allowedDomains?.length && !includesNormalized(policy.allowedDomains, domain)) {
    return { ...baseDecision, status: "denied", reason: `Domain ${domain} is not in the allowed domain list.` };
  }

  if (policy.allowedNetworks?.length && requirement.network && !includesNormalized(policy.allowedNetworks, requirement.network)) {
    return { ...baseDecision, status: "denied", reason: `Network ${requirement.network} is not allowed.` };
  }

  if (policy.allowedAssets?.length && requirement.asset && !includesNormalized(policy.allowedAssets, requirement.asset)) {
    return { ...baseDecision, status: "denied", reason: `Asset ${requirement.asset} is not allowed.` };
  }

  if (policy.allowedPayTo?.length && requirement.payTo && !includesNormalized(policy.allowedPayTo, requirement.payTo)) {
    return { ...baseDecision, status: "denied", reason: `Payee ${requirement.payTo} is not allowed.` };
  }

  if (policy.maxPaymentUsd !== undefined && amountUsd > policy.maxPaymentUsd) {
    return { ...baseDecision, status: "denied", reason: `Payment ${amountUsd} exceeds per-call limit ${policy.maxPaymentUsd}.` };
  }

  const existingReceipts = await receipts.list();
  const spentToday = existingReceipts
    .filter(receipt => receipt.status === "paid")
    .filter(receipt => isToday(receipt.timestamp))
    .reduce((sum, receipt) => sum + receipt.amountUsd, 0);

  if (policy.dailyBudgetUsd !== undefined && spentToday + amountUsd > policy.dailyBudgetUsd) {
    return { ...baseDecision, status: "denied", reason: `Payment would exceed daily budget ${policy.dailyBudgetUsd}.` };
  }

  const duplicateWindowMs = policy.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS;
  const duplicateSince = Date.now() - duplicateWindowMs;
  const duplicate = existingReceipts.some(receipt => (
    receipt.status === "paid" &&
    receipt.duplicateKey === duplicateKey &&
    new Date(receipt.timestamp).getTime() >= duplicateSince
  ));

  if (duplicate) {
    return { ...baseDecision, status: "denied", reason: "Duplicate payment attempt blocked." };
  }

  if (policy.requireApprovalAboveUsd !== undefined && amountUsd > policy.requireApprovalAboveUsd) {
    return { ...baseDecision, status: "approval_required", reason: "Payment requires human approval." };
  }

  return { ...baseDecision, status: "approved", reason: "Payment passed Safe402 policy." };
}

export type Safe402PaymentIntentInput = {
  input: Parameters<typeof fetch>[0];
  init?: Parameters<typeof fetch>[1];
  requirement?: Safe402PaymentRequirement;
};

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

export async function extractPaymentRequirement(response: Response): Promise<Safe402PaymentRequirement> {
  const headerRequirement = parsePaymentRequirementHeader(
    response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("X-PAYMENT-REQUIRED")
  );

  if (headerRequirement) {
    return headerRequirement;
  }

  const payload = await response.clone().json().catch(() => undefined) as unknown;

  if (isRecord(payload)) {
    const accepts = payload.accepts;
    if (Array.isArray(accepts) && accepts.length > 0 && isRecord(accepts[0])) {
      return accepts[0] as Safe402PaymentRequirement;
    }
  }

  return {};
}

export type Safe402ParsedAmount = {
  valid: boolean;
  amountUsd: number;
  raw: string | undefined;
  reason: string;
};

export function parseRequirementAmount(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy = {}
): Safe402ParsedAmount {
  const value = requirement.maxAmountRequired ?? requirement.amount;

  if (value === undefined || value === null) {
    return { valid: false, amountUsd: 0, raw: undefined, reason: "Payment amount is missing." };
  }

  const raw = String(value).trim();

  if (!raw) {
    return { valid: false, amountUsd: 0, raw: undefined, reason: "Payment amount is missing." };
  }

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return { valid: false, amountUsd: 0, raw, reason: `Payment amount ${raw} is invalid.` };
  }

  const decimals = resolveAssetDecimals(requirement, policy);
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return { valid: false, amountUsd: 0, raw, reason: `Payment amount ${raw} is invalid.` };
  }

  if (!raw.includes(".") && decimals !== undefined) {
    return {
      valid: true,
      amountUsd: parsed / 10 ** decimals,
      raw,
      reason: `Parsed atomic amount with ${decimals} decimals.`
    };
  }

  return { valid: true, amountUsd: parsed, raw, reason: "Parsed decimal amount." };
}

export type Safe402PrivacyFinding = {
  field: string;
  type: "email" | "phone" | "secret" | "sensitive_query";
};

export function findSensitivePaymentMetadata(requirement: Safe402PaymentRequirement): Safe402PrivacyFinding[] {
  const findings: Safe402PrivacyFinding[] = [];
  const fields = {
    resource: requirement.resource,
    description: requirement.description,
    mimeType: requirement.mimeType
  };

  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== "string") {
      continue;
    }

    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) {
      findings.push({ field, type: "email" });
    }

    if (/\+?\d[\d\s().-]{8,}\d/.test(value)) {
      findings.push({ field, type: "phone" });
    }

    if (/(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|bearer\s+[A-Za-z0-9._-]{12,})/i.test(value)) {
      findings.push({ field, type: "secret" });
    }

    if (/[?&](api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)=/i.test(value)) {
      findings.push({ field, type: "sensitive_query" });
    }
  }

  return findings;
}

function createDuplicateKey(url: URL, requirement: Safe402PaymentRequirement): string {
  return [
    url.origin,
    url.pathname,
    requirement.network ?? "",
    requirement.asset ?? "",
    requirement.payTo ?? "",
    requirement.maxAmountRequired ?? requirement.amount ?? ""
  ].join("|");
}

function createRequestIntentFingerprint(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): string {
  const url = toUrl(input);
  return stableHash({
    method: getRequestMethod(input, init),
    url: normalizeUrl(url),
    body: summarizeRequestBody(input, init)
  });
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

async function record(
  receipts: Safe402ReceiptStore,
  config: Safe402FetchConfig,
  decision: Safe402Decision,
  response?: Response
) {
  const receipt: Safe402Receipt = {
    ...decision,
    responseStatus: response?.status,
    paymentResponse: response ? getPaymentResponseHeader(response) : null
  };

  await receipts.save(receipt);
  await config.onDecision?.(decision);
}

function getPaymentResponseHeader(response: Response): string | null {
  return response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE") ?? null;
}

function toUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

function getRequestMethod(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (typeof input === "object" && !(input instanceof URL) && "method" in input && typeof input.method === "string") {
    return input.method.toUpperCase();
  }

  return "GET";
}

function summarizeRequestBody(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): unknown {
  if (init?.body !== undefined && init.body !== null) {
    return summarizeBodyValue(init.body);
  }

  if (typeof input === "object" && !(input instanceof URL) && "body" in input) {
    return "[request-body-unread]";
  }

  return null;
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

function normalizeUrl(url: URL): string {
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

function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
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

function isToday(timestamp: string): boolean {
  const input = new Date(timestamp);
  const now = new Date();

  return input.getUTCFullYear() === now.getUTCFullYear() &&
    input.getUTCMonth() === now.getUTCMonth() &&
    input.getUTCDate() === now.getUTCDate();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function includesNormalized(values: string[] | undefined, value: string): boolean {
  return values?.some(item => item.toLowerCase() === value.toLowerCase()) ?? false;
}
