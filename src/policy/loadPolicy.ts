import type { Safe402Policy } from "../types.js";
import { defaultPolicy } from "./defaultPolicy.js";

export function loadPolicy(policy: Safe402Policy = {}): Safe402Policy {
  return {
    ...defaultPolicy,
    ...policy,
    allowedPayees: mergeUnique(policy.allowedPayees, policy.allowedPayTo),
    blockedPayees: mergeUnique(policy.blockedPayees, policy.blockedPayTo),
    duplicateWindowMs: policy.duplicateWindowMs ?? defaultPolicy.duplicateWindowMs,
    failOnPaidStatusCodes: policy.failOnPaidStatusCodes ?? defaultPolicy.failOnPaidStatusCodes
  };
}

function mergeUnique(first?: string[], second?: string[]): string[] | undefined {
  const values = [...(first ?? []), ...(second ?? [])];
  return values.length > 0 ? Array.from(new Set(values)) : undefined;
}
