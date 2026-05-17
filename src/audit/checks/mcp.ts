import { parseRequirementAmount } from "../../probe/index.js";
import type { Safe402PaymentRequirement } from "../../types.js";
import { findSensitiveStrings } from "../../utils/redaction.js";
import {
  auditCheck,
  isRecord,
  scalarString,
  stringValue,
  type Safe402AuditCheck
} from "./common.js";

export type Safe402McpAuditTool = {
  name?: string;
  description?: string;
  unavailable?: boolean;
  removed?: boolean;
  priceUsd?: number | string;
  price?: number | string;
  paymentRequirement?: Safe402PaymentRequirement;
  requirement?: Safe402PaymentRequirement;
  x402?: {
    requirement?: Safe402PaymentRequirement;
    priceUsd?: number | string;
    resultBinding?: string;
    toolCallId?: string;
  };
  resultBinding?: string;
  toolCallId?: string;
  [key: string]: unknown;
};

export type Safe402McpAuditManifest = {
  name?: string;
  tools?: Safe402McpAuditTool[];
  paidTools?: Safe402McpAuditTool[];
  [key: string]: unknown;
};

export function auditMcp(input: {
  manifests?: Safe402McpAuditManifest[];
  expectedServers?: number;
}): Safe402AuditCheck[] {
  const expectedServers = input.expectedServers ?? input.manifests?.length ?? 0;

  if (!input.manifests?.length) {
    return [
      auditCheck({
        name: "MCP tool risk: paid tool manifest missing",
        severity: expectedServers > 0 ? "WARN" : "INFO",
        code: expectedServers > 0 ? "mcp_manifest_not_loaded" : "mcp_scan_not_requested",
        category: "mcp",
        reason: expectedServers > 0
          ? "MCP scan was priced or requested, but no manifest content was provided to inspect."
          : "No MCP manifest scan was requested.",
        fix: expectedServers > 0 ? "Provide MCP manifests for paid-tool audit checks." : undefined,
        details: { expectedServers }
      })
    ];
  }

  const checks: Safe402AuditCheck[] = [];

  input.manifests.forEach((manifest, index) => {
    const serverName = manifest.name ?? `MCP server ${index + 1}`;
    const tools = extractTools(manifest);
    const paidTools = tools.filter(tool => isPaidTool(tool));

    checks.push(auditCheck({
      name: "MCP tool risk: paid tool manifest missing",
      severity: paidTools.length > 0 ? "PASS" : "FAIL",
      code: paidTools.length > 0 ? "mcp_paid_manifest_present" : "mcp_paid_manifest_missing",
      category: "mcp",
      reason: paidTools.length > 0
        ? `${serverName} declares ${paidTools.length} paid tool${paidTools.length === 1 ? "" : "s"}.`
        : `${serverName} does not declare paid tool payment metadata.`,
      fix: paidTools.length > 0 ? undefined : "Add paid tool manifest metadata with x402 requirements.",
      details: { serverName, tools: tools.length, paidTools: paidTools.length }
    }));

    for (const tool of paidTools) {
      checks.push(...auditMcpTool(serverName, tool));
    }
  });

  return checks;
}

function auditMcpTool(serverName: string, tool: Safe402McpAuditTool): Safe402AuditCheck[] {
  const toolName = tool.name ?? "unnamed tool";
  const requirement = tool.paymentRequirement ?? tool.requirement ?? tool.x402?.requirement;
  const declaredPrice = numericPrice(tool.priceUsd ?? tool.price ?? tool.x402?.priceUsd);
  const requirementPrice = requirement ? parseRequirementAmount(requirement).amountUsd : undefined;
  const priceMismatch = declaredPrice !== undefined &&
    requirementPrice !== undefined &&
    Math.abs(declaredPrice - requirementPrice) > Math.max(0.000001, declaredPrice * 0.01);
  const descriptionFindings = findSensitiveStrings(tool.description ?? "", `mcp.${serverName}.${toolName}.description`);
  const hasBinding = Boolean(
    stringValue(tool.resultBinding) ||
    stringValue(tool.toolCallId) ||
    stringValue(tool.x402?.resultBinding) ||
    stringValue(tool.x402?.toolCallId) ||
    stringValue(requirement?.toolCallId) ||
    stringValue(requirement?.extra?.toolCallId)
  );

  return [
    auditCheck({
      name: "MCP tool risk: tool unavailable",
      severity: tool.unavailable || tool.removed ? "FAIL" : "PASS",
      code: tool.unavailable || tool.removed ? "mcp_paid_tool_unavailable" : "mcp_paid_tool_available",
      category: "mcp",
      reason: tool.unavailable || tool.removed
        ? `${serverName}/${toolName} is marked unavailable or removed.`
        : `${serverName}/${toolName} is available in the manifest.`,
      fix: tool.unavailable || tool.removed ? "Do not auto-pay tools that disappeared or became unavailable after discovery." : undefined,
      details: { serverName, toolName }
    }),
    auditCheck({
      name: "MCP tool risk: tool price mismatch",
      severity: priceMismatch ? "FAIL" : "PASS",
      code: priceMismatch ? "mcp_tool_price_mismatch" : "mcp_tool_price_consistent",
      category: "mcp",
      reason: priceMismatch
        ? `${serverName}/${toolName} declares price ${declaredPrice}, but x402 requirement implies ${requirementPrice}.`
        : `${serverName}/${toolName} price metadata is consistent or only one price source was declared.`,
      fix: priceMismatch ? "Match tool manifest price and x402 machine-readable amount." : undefined,
      details: { serverName, toolName, declaredPrice, requirementPrice }
    }),
    auditCheck({
      name: "MCP tool risk: tool removed after discovery",
      severity: tool.removed ? "FAIL" : "PASS",
      code: tool.removed ? "mcp_tool_removed_after_discovery" : "mcp_tool_not_removed",
      category: "mcp",
      reason: tool.removed
        ? `${serverName}/${toolName} appears removed after discovery.`
        : `${serverName}/${toolName} is not marked removed.`,
      fix: tool.removed ? "Refresh discovery and require approval before paying removed or replaced tools." : undefined,
      details: { serverName, toolName }
    }),
    auditCheck({
      name: "MCP tool risk: tool description leaks sensitive info",
      severity: descriptionFindings.length > 0 ? "WARN" : "PASS",
      code: descriptionFindings.length > 0 ? "mcp_tool_description_leaks" : "mcp_tool_description_clean",
      category: "mcp",
      reason: descriptionFindings.length > 0
        ? `${serverName}/${toolName} description contains sensitive-looking text.`
        : `${serverName}/${toolName} description did not expose sensitive-looking text.`,
      fix: descriptionFindings.length > 0 ? "Remove sensitive info from MCP tool descriptions." : undefined,
      details: {
        serverName,
        toolName,
        findings: descriptionFindings.map(finding => finding.type)
      }
    }),
    auditCheck({
      name: "MCP tool risk: paid result bound to tool call",
      severity: hasBinding ? "PASS" : "WARN",
      code: hasBinding ? "mcp_paid_result_bound" : "mcp_paid_result_unbound",
      category: "mcp",
      reason: hasBinding
        ? `${serverName}/${toolName} exposes binding metadata for paid results.`
        : `${serverName}/${toolName} does not expose binding metadata between payment and tool call.`,
      fix: hasBinding ? undefined : "Bind paid result to tool call ID and payment identifier.",
      details: { serverName, toolName }
    })
  ];
}

function extractTools(manifest: Safe402McpAuditManifest): Safe402McpAuditTool[] {
  const rawTools = [
    ...(Array.isArray(manifest.tools) ? manifest.tools : []),
    ...(Array.isArray(manifest.paidTools) ? manifest.paidTools : [])
  ];

  return rawTools.filter((tool): tool is Safe402McpAuditTool => isRecord(tool));
}

function isPaidTool(tool: Safe402McpAuditTool): boolean {
  return Boolean(
    tool.paymentRequirement ||
    tool.requirement ||
    tool.x402?.requirement ||
    scalarString(tool.priceUsd) ||
    scalarString(tool.price)
  );
}

function numericPrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const stripped = value.replace(/^\$/, "").trim();
    const parsed = Number(stripped);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
