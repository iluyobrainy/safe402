import type { Safe402PaymentRequirement, Safe402Policy } from "../../types.js";
import {
  auditCheck,
  includesNormalized,
  isRecord,
  stringValue,
  type Safe402AuditCheck
} from "./common.js";

const SUSPICIOUS_FACILITATOR_PATTERNS = [
  /\bngrok-free\.app\b/i,
  /\blocalhost\b/i,
  /\b127\.0\.0\.1\b/i,
  /\b0\.0\.0\.0\b/i,
  /\bexample\.com\b/i,
  /\btest-only\b/i
];

export function auditFacilitator(input: {
  endpoint?: string;
  requirement?: Safe402PaymentRequirement;
  policy?: Safe402Policy;
}): Safe402AuditCheck[] {
  const requirement = input.requirement;
  const facilitator = facilitatorValue(requirement);
  const settlementProof = hasSettlementProof(requirement);
  const allowedFacilitators = allowedFacilitatorList(input.policy);
  const checks: Safe402AuditCheck[] = [];

  if (!facilitator) {
    checks.push(auditCheck({
      name: "facilitator risk: missing facilitator",
      severity: "WARN",
      code: "facilitator_missing",
      category: "facilitator",
      endpoint: input.endpoint,
      reason: "The payment requirement does not declare a facilitator.",
      fix: "Add facilitator metadata or document how settlement verification is performed."
    }));
  } else {
    checks.push(auditCheck({
      name: "facilitator risk: missing facilitator",
      severity: "PASS",
      code: "facilitator_present",
      category: "facilitator",
      endpoint: input.endpoint,
      reason: "The payment requirement declares a facilitator.",
      details: { facilitator }
    }));
  }

  checks.push(checkUnsupportedFacilitator(facilitator, allowedFacilitators, input.endpoint));
  checks.push(checkSettlementProof(settlementProof, input.endpoint));
  checks.push(checkSuspiciousFacilitatorUrl(facilitator, input.endpoint));

  return checks;
}

function checkUnsupportedFacilitator(
  facilitator: string | undefined,
  allowedFacilitators: string[],
  endpoint?: string
): Safe402AuditCheck {
  if (!facilitator) {
    return auditCheck({
      name: "facilitator risk: unsupported facilitator",
      severity: "WARN",
      code: "facilitator_support_unknown",
      category: "facilitator",
      endpoint,
      reason: "Facilitator support could not be validated because no facilitator was declared.",
      fix: "Declare a supported facilitator URL or require manual approval."
    });
  }

  if (allowedFacilitators.length > 0 && !includesNormalized(allowedFacilitators, facilitator)) {
    return auditCheck({
      name: "facilitator risk: unsupported facilitator",
      severity: "FAIL",
      code: "facilitator_unsupported",
      category: "facilitator",
      endpoint,
      reason: `Facilitator ${facilitator} is not in the allowed facilitator list.`,
      fix: "Use a supported facilitator or require manual approval.",
      details: {
        facilitator,
        allowedFacilitators
      }
    });
  }

  return auditCheck({
    name: "facilitator risk: unsupported facilitator",
    severity: allowedFacilitators.length > 0 ? "PASS" : "INFO",
    code: allowedFacilitators.length > 0 ? "facilitator_supported" : "facilitator_not_allowlisted",
    category: "facilitator",
    endpoint,
    reason: allowedFacilitators.length > 0
      ? "Facilitator is in the allowed facilitator list."
      : "Facilitator is declared, but no allowlist was configured.",
    fix: allowedFacilitators.length > 0 ? undefined : "Add a facilitator allowlist for autopay flows.",
    details: { facilitator }
  });
}

function checkSettlementProof(settlementProof: boolean, endpoint?: string): Safe402AuditCheck {
  return auditCheck({
    name: "facilitator risk: no settlement proof",
    severity: settlementProof ? "PASS" : "WARN",
    code: settlementProof ? "settlement_proof_present" : "settlement_proof_missing",
    category: "facilitator",
    endpoint,
    reason: settlementProof
      ? "The payment requirement includes settlement proof or a verification reference."
      : "The payment requirement does not expose settlement proof or a verification reference.",
    fix: settlementProof ? undefined : "Add settlement proof, verify URL, or require PAYMENT-RESPONSE receipt validation."
  });
}

function checkSuspiciousFacilitatorUrl(
  facilitator: string | undefined,
  endpoint?: string
): Safe402AuditCheck {
  if (!facilitator) {
    return auditCheck({
      name: "facilitator risk: suspicious facilitator URL",
      severity: "INFO",
      code: "facilitator_url_unchecked",
      category: "facilitator",
      endpoint,
      reason: "No facilitator URL was available to inspect."
    });
  }

  let parsed: URL | undefined;
  try {
    parsed = new URL(facilitator);
  } catch {
    return auditCheck({
      name: "facilitator risk: suspicious facilitator URL",
      severity: "CRITICAL",
      code: "facilitator_url_invalid",
      category: "facilitator",
      endpoint,
      reason: "Facilitator URL is not a valid URL.",
      fix: "Use an HTTPS facilitator URL from a trusted provider.",
      details: { facilitator }
    });
  }

  if (parsed.protocol !== "https:") {
    return auditCheck({
      name: "facilitator risk: suspicious facilitator URL",
      severity: "FAIL",
      code: "facilitator_url_not_https",
      category: "facilitator",
      endpoint,
      reason: "Facilitator URL is not HTTPS.",
      fix: "Use an HTTPS facilitator URL from a trusted provider.",
      details: { facilitator }
    });
  }

  if (SUSPICIOUS_FACILITATOR_PATTERNS.some(pattern => pattern.test(facilitator))) {
    return auditCheck({
      name: "facilitator risk: suspicious facilitator URL",
      severity: "WARN",
      code: "facilitator_url_suspicious",
      category: "facilitator",
      endpoint,
      reason: "Facilitator URL looks temporary, local, or non-production.",
      fix: "Use a production facilitator URL and require manual approval for temporary facilitators.",
      details: { facilitator }
    });
  }

  return auditCheck({
    name: "facilitator risk: suspicious facilitator URL",
    severity: "PASS",
    code: "facilitator_url_https",
    category: "facilitator",
    endpoint,
    reason: "Facilitator URL is HTTPS and does not match common temporary/local patterns.",
    details: { facilitator }
  });
}

function facilitatorValue(requirement: Safe402PaymentRequirement | undefined): string | undefined {
  if (!requirement) {
    return undefined;
  }

  const rawFacilitator = (requirement as Record<string, unknown>).facilitator;

  if (typeof rawFacilitator === "string") {
    return stringValue(rawFacilitator);
  }

  if (isRecord(rawFacilitator)) {
    return stringValue(rawFacilitator.url ?? rawFacilitator.endpoint ?? rawFacilitator.name);
  }

  return stringValue(requirement.facilitatorUrl ?? requirement.facilitatorURL ?? requirement.extra?.facilitator);
}

function hasSettlementProof(requirement: Safe402PaymentRequirement | undefined): boolean {
  if (!requirement) {
    return false;
  }

  return Boolean(
    stringValue(requirement.settlementProof) ||
    stringValue(requirement.settlement_proof) ||
    stringValue(requirement.verifyUrl) ||
    stringValue(requirement.verificationUrl) ||
    stringValue(requirement.paymentResponse) ||
    stringValue(requirement.extra?.settlementProof) ||
    stringValue(requirement.extra?.verifyUrl)
  );
}

function allowedFacilitatorList(policy: Safe402Policy | undefined): string[] {
  const value = (policy as { allowedFacilitators?: unknown } | undefined)?.allowedFacilitators;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
