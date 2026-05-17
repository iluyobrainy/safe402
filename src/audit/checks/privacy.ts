import type { Safe402PaymentRequirement, Safe402PrivacyFinding } from "../../types.js";
import { findSensitivePaymentMetadata } from "../../utils/index.js";
import {
  auditCheck,
  type Safe402AuditCheck
} from "./common.js";

export function auditPrivacy(input: {
  endpoint?: string;
  requirement?: Safe402PaymentRequirement;
}): Safe402AuditCheck[] {
  if (!input.requirement) {
    return [
      auditCheck({
        name: "metadata privacy check",
        severity: "WARN",
        code: "privacy_unchecked",
        category: "privacy",
        endpoint: input.endpoint,
        reason: "No payment requirement was available for privacy scanning.",
        fix: "Return a valid payment requirement so metadata can be scanned before payment."
      })
    ];
  }

  const findings = findSensitivePaymentMetadata(input.requirement);
  const checks: Safe402AuditCheck[] = [];

  checks.push(checkFindingGroup({
    endpoint: input.endpoint,
    name: "PII in description",
    code: "pii_in_description",
    passCode: "description_privacy_clean",
    findings,
    match: finding => finding.field.toLowerCase().includes("description") &&
      ["email", "phone", "personal_identifier", "private_task_reason"].includes(finding.type),
    failReason: "Description metadata contains PII or private task context.",
    passReason: "Description metadata did not expose PII.",
    fix: "Remove PII from metadata and keep descriptions generic."
  }));
  checks.push(checkFindingGroup({
    endpoint: input.endpoint,
    name: "PII in resource URL",
    code: "pii_in_resource_url",
    passCode: "resource_privacy_clean",
    findings,
    match: finding => finding.field.toLowerCase().includes("resource") &&
      ["email", "phone", "personal_identifier", "sensitive_query"].includes(finding.type),
    failReason: "Resource URL contains sensitive user or credential data.",
    passReason: "Resource URL did not expose sensitive query parameters or PII.",
    fix: "Remove PII and API keys from resource URLs before issuing payment challenges."
  }));
  checks.push(checkFindingGroup({
    endpoint: input.endpoint,
    name: "PII in reason strings",
    code: "pii_in_reason",
    passCode: "reason_privacy_clean",
    findings,
    match: finding => finding.field.toLowerCase().includes("reason") &&
      ["email", "phone", "personal_identifier", "private_task_reason"].includes(finding.type),
    failReason: "Reason strings contain PII or private task context.",
    passReason: "Reason strings did not expose PII.",
    fix: "Remove PII from reason strings and use opaque request identifiers."
  }));
  checks.push(checkFindingGroup({
    endpoint: input.endpoint,
    name: "API keys in metadata",
    code: "api_key_in_metadata",
    passCode: "metadata_secret_clean",
    findings,
    match: finding => ["api_key", "bearer_token", "secret", "sensitive_query"].includes(finding.type),
    failReason: "Payment metadata appears to expose an API key, bearer token, secret, or sensitive query parameter.",
    passReason: "Payment metadata did not expose API keys or bearer tokens.",
    fix: "Remove API keys from metadata and rotate any key that was exposed."
  }));
  checks.push(checkFindingGroup({
    endpoint: input.endpoint,
    name: "wallet-linked sensitive metadata",
    code: "wallet_linked_sensitive_metadata",
    passCode: "wallet_metadata_clean",
    findings,
    match: finding => finding.type === "wallet_linked_note",
    failReason: "Metadata appears to link a wallet or payee to sensitive user identity context.",
    passReason: "Metadata did not link wallet identity to sensitive context.",
    fix: "Remove wallet-linked sensitive metadata from payment requirements."
  }));

  return checks;
}

function checkFindingGroup(input: {
  endpoint?: string;
  name: string;
  code: string;
  passCode: string;
  findings: Safe402PrivacyFinding[];
  match: (finding: Safe402PrivacyFinding) => boolean;
  failReason: string;
  passReason: string;
  fix: string;
}): Safe402AuditCheck {
  const matches = input.findings.filter(input.match);
  const critical = matches.some(finding =>
    finding.type === "api_key" ||
    finding.type === "bearer_token" ||
    finding.type === "secret" ||
    finding.type === "sensitive_query"
  );

  if (matches.length > 0) {
    return auditCheck({
      name: input.name,
      severity: critical ? "CRITICAL" : "WARN",
      code: input.code,
      category: "privacy",
      endpoint: input.endpoint,
      reason: input.failReason,
      fix: input.fix,
      details: {
        findings: matches.map(finding => ({
          field: finding.field,
          type: finding.type
        }))
      }
    });
  }

  return auditCheck({
    name: input.name,
    severity: "PASS",
    code: input.passCode,
    category: "privacy",
    endpoint: input.endpoint,
    reason: input.passReason
  });
}
