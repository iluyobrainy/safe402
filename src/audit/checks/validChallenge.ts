import {
  detectAmountAmbiguity,
  type Safe402ProbeResult
} from "../../probe/index.js";
import { parseRequirementAmount } from "../../probe/parseRequirementAmount.js";
import type { Safe402PaymentRequirement, Safe402Policy } from "../../types.js";
import {
  auditCheck,
  includesNormalized,
  isRecord,
  normalizeScalar,
  scalarString,
  stringValue,
  type Safe402AuditCheck
} from "./common.js";

export function auditValidChallenge(input: {
  endpoint?: string;
  probe?: Safe402ProbeResult;
  requirement?: Safe402PaymentRequirement;
  policy?: Safe402Policy;
}): Safe402AuditCheck[] {
  const policy = input.policy ?? {};
  const endpoint = input.endpoint ?? input.probe?.url;
  const requirements = input.probe?.paymentOptions.map(option => option.requirement) ??
    (input.requirement ? [input.requirement] : []);
  const primary = input.probe?.selectedOption?.option.requirement ?? requirements[0];
  const checks: Safe402AuditCheck[] = [];

  checks.push(checkChallengeStructure(primary, endpoint));
  checks.push(checkMultipleAccepts(requirements, endpoint));

  if (!primary) {
    return checks;
  }

  checks.push(...checkAmountAndDecimals(primary, policy, endpoint));
  checks.push(checkClearHumanPrice(primary, policy, endpoint));
  checks.push(checkUnsupportedChain(primary, policy, endpoint));
  checks.push(checkUnsupportedAsset(primary, policy, endpoint));
  checks.push(checkPayTo(primary, policy, endpoint));

  return checks;
}

function checkClearHumanPrice(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy,
  endpoint?: string
): Safe402AuditCheck {
  const parsedAmount = parseRequirementAmount(requirement, policy);
  const fields = [
    requirement.description,
    requirement.resource,
    typeof requirement.extra?.description === "string" ? requirement.extra.description : undefined,
    typeof requirement.extra?.reason === "string" ? requirement.extra.reason : undefined
  ].filter((value): value is string => typeof value === "string");
  const hasHumanPrice = fields.some(value => /\$\s*\d+(?:\.\d+)?|\bUSD\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:USD|USDC)\b/i.test(value));

  if (hasHumanPrice) {
    return auditCheck({
      name: "clear human-readable price",
      severity: "PASS",
      code: "human_price_present",
      category: "challenge",
      endpoint,
      reason: "The challenge includes a human-readable price.",
      details: {
        amountUsd: parsedAmount.valid ? parsedAmount.amountUsd : undefined
      }
    });
  }

  return auditCheck({
    name: "clear human-readable price",
    severity: "WARN",
    code: "human_price_missing",
    category: "challenge",
    endpoint,
    reason: "The challenge does not include a clear human-readable price for review before payment.",
    fix: "Add clear human price.",
    details: {
      amountUsd: parsedAmount.valid ? parsedAmount.amountUsd : undefined
    }
  });
}

export function checkChallengeStructure(
  requirement: Safe402PaymentRequirement | undefined,
  endpoint?: string
): Safe402AuditCheck {
  if (!requirement || Object.keys(requirement).length === 0) {
    return auditCheck({
      name: "valid 402 challenge structure",
      severity: "CRITICAL",
      code: "invalid_x402_challenge",
      category: "challenge",
      endpoint,
      reason: "HTTP 402 did not contain a usable x402 payment requirement.",
      fix: "Return an x402 accepts array or payment requirement with scheme, network, asset, payTo, amount, and resource fields."
    });
  }

  const missing: string[] = [];
  if (!stringValue(requirement.scheme)) {
    missing.push("scheme");
  }
  if (!stringValue(requirement.network ?? requirement.chain)) {
    missing.push("network");
  }
  if (!stringValue(requirement.asset)) {
    missing.push("asset");
  }
  if (!stringValue(requirement.payTo ?? requirement.payee ?? requirement.recipient ?? requirement.to)) {
    missing.push("payTo");
  }
  if (!scalarString(requirement.maxAmountRequired ?? requirement.amount ?? requirement.amountUsd)) {
    missing.push("amount");
  }
  if (!stringValue(requirement.resource ?? requirement.url)) {
    missing.push("resource");
  }

  if (missing.length > 0) {
    return auditCheck({
      name: "valid 402 challenge structure",
      severity: "CRITICAL",
      code: "invalid_x402_challenge",
      category: "challenge",
      endpoint,
      reason: `x402 challenge is missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
      fix: "Return a complete x402 payment requirement before asking agents to pay.",
      details: { missing }
    });
  }

  return auditCheck({
    name: "valid 402 challenge structure",
    severity: "PASS",
    code: "valid_x402_challenge",
    category: "challenge",
    endpoint,
    reason: "The x402 challenge includes the core payment fields needed for policy evaluation.",
    details: {
      scheme: requirement.scheme,
      network: requirement.network ?? requirement.chain,
      asset: requirement.asset,
      payTo: requirement.payTo,
      resource: requirement.resource
    }
  });
}

export function checkMultipleAccepts(
  requirements: Safe402PaymentRequirement[],
  endpoint?: string
): Safe402AuditCheck {
  if (requirements.length === 0) {
    return auditCheck({
      name: "multiple accepts handling",
      severity: "CRITICAL",
      code: "missing_accepts",
      category: "challenge",
      endpoint,
      reason: "No accepts entries were available to evaluate.",
      fix: "Expose at least one valid accepts entry in the x402 challenge."
    });
  }

  if (requirements.length === 1) {
    return auditCheck({
      name: "multiple accepts handling",
      severity: "INFO",
      code: "single_accept",
      category: "challenge",
      endpoint,
      reason: "The challenge exposes one payment option.",
      details: { accepts: 1 }
    });
  }

  const amountSet = new Set(requirements.map(requirement => normalizeScalar(requirement.maxAmountRequired ?? requirement.amount ?? requirement.amountUsd)));
  const payToSet = new Set(requirements.map(requirement => normalizeScalar(requirement.payTo ?? requirement.payee ?? requirement.recipient ?? requirement.to)));
  const networkSet = new Set(requirements.map(requirement => normalizeScalar(requirement.network ?? requirement.chain)));
  const diverges = amountSet.size > 1 || payToSet.size > 1 || networkSet.size > 1;

  return auditCheck({
    name: "multiple accepts handling",
    severity: diverges ? "WARN" : "PASS",
    code: diverges ? "accepts_options_diverge" : "multiple_accepts_supported",
    category: "challenge",
    endpoint,
    reason: diverges
      ? "Multiple accepts entries are present and differ in amount, payee, or network; agents must choose deterministically by policy."
      : "Multiple accepts entries are present and stable across the payment-critical fields.",
    fix: diverges
      ? "Order accepts options by safest compatible rail, make the cheapest equivalent option obvious, and require approval when options diverge materially."
      : undefined,
    details: {
      accepts: requirements.length,
      distinctAmounts: amountSet.size,
      distinctPayTo: payToSet.size,
      distinctNetworks: networkSet.size
    }
  });
}

function checkAmountAndDecimals(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy,
  endpoint?: string
): Safe402AuditCheck[] {
  const parsedAmount = parseRequirementAmount(requirement, policy);
  const ambiguity = detectAmountAmbiguity({
    requirement,
    parsedAmount,
    policy
  });
  const checks: Safe402AuditCheck[] = [];
  const priceMismatch = ambiguity.find(finding =>
    finding.code === "description_price_mismatch" ||
    finding.code === "amount_field_mismatch"
  );
  const decimalsAmbiguity = ambiguity.find(finding => finding.code === "asset_decimals_unclear");

  if (!parsedAmount.valid) {
    checks.push(auditCheck({
      name: "machine-readable amount",
      severity: "CRITICAL",
      code: "invalid_amount",
      category: "challenge",
      endpoint,
      reason: parsedAmount.reason,
      fix: "Use a positive numeric amount and declare asset decimals for atomic token values."
    }));
  } else if (priceMismatch) {
    checks.push(auditCheck({
      name: "human price matches machine amount",
      severity: "FAIL",
      code: priceMismatch.code,
      category: "challenge",
      endpoint,
      reason: priceMismatch.message,
      fix: "Match human price and machine amount before allowing agents to pay.",
      details: priceMismatch as unknown as Record<string, unknown>
    }));
  } else {
    checks.push(auditCheck({
      name: "human price matches machine amount",
      severity: "PASS",
      code: "price_amount_consistent",
      category: "challenge",
      endpoint,
      reason: "No human-readable price mismatch was detected.",
      details: {
        amountUsd: parsedAmount.amountUsd,
        source: parsedAmount.source
      }
    }));
  }

  if (decimalsAmbiguity) {
    checks.push(auditCheck({
      name: "asset decimals ambiguity",
      severity: "WARN",
      code: "asset_decimals_ambiguous",
      category: "challenge",
      endpoint,
      reason: decimalsAmbiguity.message,
      fix: "Fix chain and asset declaration, or include assetDecimals for atomic amounts.",
      details: decimalsAmbiguity as unknown as Record<string, unknown>
    }));
  } else {
    checks.push(auditCheck({
      name: "asset decimals ambiguity",
      severity: "PASS",
      code: "asset_decimals_resolved",
      category: "challenge",
      endpoint,
      reason: parsedAmount.assetDecimals !== undefined
        ? `Asset decimals resolved to ${parsedAmount.assetDecimals}.`
        : "The amount did not require token-decimal interpretation.",
      details: {
        assetDecimals: parsedAmount.assetDecimals,
        decimalsSource: parsedAmount.decimalsSource,
        atomic: parsedAmount.atomic
      }
    }));
  }

  return checks;
}

function checkUnsupportedChain(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy,
  endpoint?: string
): Safe402AuditCheck {
  const network = stringValue(requirement.network ?? requirement.chain);

  if (!network) {
    return auditCheck({
      name: "supported payment chain",
      severity: "CRITICAL",
      code: "missing_network",
      category: "challenge",
      endpoint,
      reason: "The payment requirement does not declare a network or chain.",
      fix: "Fix chain and asset declaration before taking payment."
    });
  }

  if (policy.allowedNetworks?.length && !includesNormalized(policy.allowedNetworks, network)) {
    return auditCheck({
      name: "supported payment chain",
      severity: "FAIL",
      code: "unsupported_chain",
      category: "challenge",
      endpoint,
      reason: `Network ${network} is not allowed by the audit policy.`,
      fix: "Use supported USDC rails or require manual approval for this chain.",
      details: {
        network,
        allowedNetworks: policy.allowedNetworks
      }
    });
  }

  return auditCheck({
    name: "supported payment chain",
    severity: "PASS",
    code: "supported_chain",
    category: "challenge",
    endpoint,
    reason: `Network ${network} is acceptable for this audit policy.`,
    details: { network }
  });
}

function checkUnsupportedAsset(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy,
  endpoint?: string
): Safe402AuditCheck {
  const asset = stringValue(requirement.asset);

  if (!asset) {
    return auditCheck({
      name: "supported payment asset",
      severity: "CRITICAL",
      code: "missing_asset",
      category: "challenge",
      endpoint,
      reason: "The payment requirement does not declare an asset.",
      fix: "Declare the payment asset and decimals before taking payment."
    });
  }

  if (policy.allowedAssets?.length && !includesNormalized(policy.allowedAssets, asset)) {
    return auditCheck({
      name: "supported payment asset",
      severity: "FAIL",
      code: "unsupported_asset",
      category: "challenge",
      endpoint,
      reason: `Asset ${asset} is not allowed by the audit policy.`,
      fix: "Use supported USDC rails or require manual approval for this asset.",
      details: {
        asset,
        allowedAssets: policy.allowedAssets
      }
    });
  }

  return auditCheck({
    name: "supported payment asset",
    severity: "PASS",
    code: "supported_asset",
    category: "challenge",
    endpoint,
    reason: `Asset ${asset} is acceptable for this audit policy.`,
    details: { asset }
  });
}

function checkPayTo(
  requirement: Safe402PaymentRequirement,
  policy: Safe402Policy,
  endpoint?: string
): Safe402AuditCheck {
  const payTo = stringValue(requirement.payTo ?? requirement.payee ?? requirement.recipient ?? requirement.to);
  const allowedPayees = [
    ...(policy.allowedPayTo ?? []),
    ...(policy.allowedPayees ?? [])
  ];

  if (!payTo) {
    return auditCheck({
      name: "expected payTo recipient",
      severity: "CRITICAL",
      code: "missing_pay_to",
      category: "challenge",
      endpoint,
      reason: "The payment requirement does not declare the recipient address.",
      fix: "Add a stable payTo recipient before agents can safely pay."
    });
  }

  if (allowedPayees.length > 0 && !includesNormalized(allowedPayees, payTo)) {
    return auditCheck({
      name: "expected payTo recipient",
      severity: "FAIL",
      code: "unexpected_pay_to",
      category: "challenge",
      endpoint,
      reason: `payTo ${payTo} is not in the audit policy allowlist.`,
      fix: "Stabilize payTo or require manual approval for this recipient.",
      details: {
        payTo,
        allowedPayees
      }
    });
  }

  if (isRecord(requirement.extra) && typeof requirement.extra.walletOwner === "string") {
    return auditCheck({
      name: "expected payTo recipient",
      severity: "WARN",
      code: "wallet_linked_metadata",
      category: "challenge",
      endpoint,
      reason: "payTo is present, but wallet-linked owner metadata is included in the challenge.",
      fix: "Remove wallet-linked sensitive metadata from payment requirements."
    });
  }

  return auditCheck({
    name: "expected payTo recipient",
    severity: allowedPayees.length > 0 ? "PASS" : "INFO",
    code: allowedPayees.length > 0 ? "expected_pay_to" : "pay_to_not_allowlisted",
    category: "challenge",
    endpoint,
    reason: allowedPayees.length > 0
      ? "payTo matches the audit policy allowlist."
      : "payTo is present, but no recipient allowlist was configured.",
    fix: allowedPayees.length > 0 ? undefined : "Add a manual approval threshold or allowlist expected payTo recipients for autopay.",
    details: { payTo }
  });
}
