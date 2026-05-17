import { extractPaymentRequirements } from "../../probe/index.js";
import type { Safe402PaymentRequirement } from "../../types.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";
import {
  auditCheck,
  normalizeScalar,
  type Safe402AuditCheck
} from "./common.js";

export type Safe402ChallengeSnapshot = {
  requirement?: Safe402PaymentRequirement;
  responseStatus?: number;
  error?: string;
};

export async function auditChallengeStability(input: {
  endpoint: string;
  fetch?: typeof fetch;
  attempts?: number;
  timeoutMs?: number;
  requestInit?: RequestInit;
}): Promise<Safe402AuditCheck[]> {
  const attempts = Math.max(2, input.attempts ?? 3);
  const snapshots: Safe402ChallengeSnapshot[] = [];

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetchWithTimeout(input.endpoint, {
        ...(input.requestInit ?? {}),
        fetch: input.fetch,
        timeoutMs: input.timeoutMs
      });
      if (response.status !== 402) {
        snapshots.push({
          responseStatus: response.status,
          error: `Expected 402, got ${response.status}.`
        });
        continue;
      }

      const extraction = await extractPaymentRequirements(response);
      snapshots.push({
        responseStatus: response.status,
        requirement: extraction.requirements[0]?.requirement,
        error: extraction.requirements.length === 0 ? "No payment requirement found." : undefined
      });
    } catch (error) {
      snapshots.push({
        error: error instanceof Error ? error.message : "unknown fetch error"
      });
    }
  }

  return auditChallengeStabilitySnapshots(input.endpoint, snapshots);
}

export function auditChallengeStabilitySnapshots(
  endpoint: string,
  snapshots: Safe402ChallengeSnapshot[]
): Safe402AuditCheck[] {
  const checks: Safe402AuditCheck[] = [];
  const first = snapshots.find(snapshot => snapshot.requirement)?.requirement;

  if (!first) {
    return [
      auditCheck({
        name: "repeated challenge stability",
        severity: "FAIL",
        code: "challenge_unavailable_for_stability",
        category: "stability",
        endpoint,
        reason: "Safe402 could not capture a valid 402 challenge repeatedly enough to test stability.",
        fix: "Make the endpoint reachable and return a valid 402 challenge before audit stability checks run.",
        details: { snapshots }
      })
    ];
  }

  checks.push(compareField({
    endpoint,
    field: "payTo",
    code: "pay_to_changed",
    stableCode: "pay_to_stable",
    name: "payTo changed across repeated challenges",
    values: snapshots.map(snapshot => snapshot.requirement?.payTo ?? snapshot.requirement?.payee ?? snapshot.requirement?.recipient ?? snapshot.requirement?.to),
    fix: "Stabilize payTo across repeated 402 challenges."
  }));
  checks.push(compareField({
    endpoint,
    field: "amount",
    code: "amount_changed",
    stableCode: "amount_stable",
    name: "amount changed across repeated challenges",
    values: snapshots.map(snapshot => snapshot.requirement?.maxAmountRequired ?? snapshot.requirement?.amount ?? snapshot.requirement?.amountUsd),
    fix: "Stabilize amount across repeated 402 challenges."
  }));
  checks.push(compareField({
    endpoint,
    field: "resource",
    code: "resource_changed",
    stableCode: "resource_stable",
    name: "resource changed across repeated challenges",
    values: snapshots.map(snapshot => snapshot.requirement?.resource ?? snapshot.requirement?.url),
    fix: "Bind the payment request to a stable resource URL."
  }));

  const errors = snapshots.filter(snapshot => snapshot.error);
  checks.push(auditCheck({
    name: "repeated challenge stability",
    severity: errors.length > 0 ? "WARN" : "PASS",
    code: errors.length > 0 ? "challenge_repeat_partial" : "challenge_repeat_stable",
    category: "stability",
    endpoint,
    reason: errors.length > 0
      ? "At least one repeated challenge request failed or returned a non-402 response."
      : "Repeated challenge requests returned parseable x402 requirements.",
    fix: errors.length > 0
      ? "Make repeated unpaid 402 challenge requests deterministic and reachable."
      : undefined,
    details: {
      attempts: snapshots.length,
      errors: errors.map(snapshot => snapshot.error)
    }
  }));

  return checks;
}

function compareField(input: {
  endpoint: string;
  name: string;
  field: string;
  code: string;
  stableCode: string;
  values: unknown[];
  fix: string;
}): Safe402AuditCheck {
  const values = input.values.map(normalizeScalar).filter(Boolean);
  const distinct = new Set(values);

  if (values.length === 0) {
    return auditCheck({
      name: input.name,
      severity: "CRITICAL",
      code: `${input.field}_missing`,
      category: "stability",
      endpoint: input.endpoint,
      reason: `${input.field} was not available in repeated challenges.`,
      fix: input.fix
    });
  }

  if (distinct.size > 1) {
    return auditCheck({
      name: input.name,
      severity: "CRITICAL",
      code: input.code,
      category: "stability",
      endpoint: input.endpoint,
      reason: `${input.field} changed across repeated challenge requests.`,
      fix: input.fix,
      details: {
        values: Array.from(distinct)
      }
    });
  }

  return auditCheck({
    name: input.name,
    severity: "PASS",
    code: input.stableCode,
    category: "stability",
    endpoint: input.endpoint,
    reason: `${input.field} remained stable across repeated challenge requests.`,
    details: {
      value: values[0]
    }
  });
}
