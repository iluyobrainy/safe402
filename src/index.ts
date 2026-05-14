export type Safe402DecisionStatus =
  | "approved"
  | "denied"
  | "approval_required"
  | "paid"
  | "free";

export type Safe402PaymentRequirement = {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  maxAmountRequired?: string;
  amount?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
};

export type Safe402Policy = {
  maxPaymentUsd?: number;
  dailyBudgetUsd?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedNetworks?: string[];
  allowedAssets?: string[];
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

    const requirement = await extractRequirement(firstResponse);
    const decision = await evaluatePayment({
      url,
      requirement,
      policy: config.policy ?? {},
      receipts
    });

    await config.onDecision?.(decision);

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

    const paidResponse = await config.paidFetch(input, init);
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
}): Promise<Safe402Decision> {
  const { url, requirement, policy, receipts } = input;
  const amountUsd = parseAmountUsd(requirement);
  const domain = url.hostname;
  const timestamp = new Date().toISOString();
  const duplicateKey = createDuplicateKey(url, requirement);

  const baseDecision = {
    url: url.href,
    domain,
    amountUsd,
    requirement,
    duplicateKey,
    timestamp
  };

  if (policy.blockedDomains?.includes(domain)) {
    return { ...baseDecision, status: "denied", reason: `Domain ${domain} is blocked.` };
  }

  if (policy.allowedDomains?.length && !policy.allowedDomains.includes(domain)) {
    return { ...baseDecision, status: "denied", reason: `Domain ${domain} is not in the allowed domain list.` };
  }

  if (policy.allowedNetworks?.length && requirement.network && !policy.allowedNetworks.includes(requirement.network)) {
    return { ...baseDecision, status: "denied", reason: `Network ${requirement.network} is not allowed.` };
  }

  if (policy.allowedAssets?.length && requirement.asset && !policy.allowedAssets.includes(requirement.asset)) {
    return { ...baseDecision, status: "denied", reason: `Asset ${requirement.asset} is not allowed.` };
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

async function extractRequirement(response: Response): Promise<Safe402PaymentRequirement> {
  const payload = await response.clone().json().catch(() => undefined) as unknown;

  if (isRecord(payload)) {
    const accepts = payload.accepts;
    if (Array.isArray(accepts) && accepts.length > 0 && isRecord(accepts[0])) {
      return accepts[0] as Safe402PaymentRequirement;
    }
  }

  return {};
}

function parseAmountUsd(requirement: Safe402PaymentRequirement): number {
  const value = requirement.maxAmountRequired ?? requirement.amount ?? "0";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

async function record(
  receipts: Safe402ReceiptStore,
  config: Safe402FetchConfig,
  decision: Safe402Decision,
  response?: Response
) {
  const receipt: Safe402Receipt = {
    ...decision,
    responseStatus: response?.status,
    paymentResponse: response?.headers.get("PAYMENT-RESPONSE") ?? response?.headers.get("X-PAYMENT-RESPONSE") ?? null
  };

  await receipts.save(receipt);
  await config.onDecision?.(decision);
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
