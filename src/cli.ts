#!/usr/bin/env node
import { access, readFile, writeFile } from "node:fs/promises";
import {
  formatAuditQuote,
  quoteAudit,
  runAudit,
  type Safe402AuditCase,
  type Safe402AuditProfile,
  type Safe402AuditQuote,
  type Safe402AuditReport,
  type Safe402McpAuditManifest
} from "./audit/index.js";
import {
  collectAuditBilling,
  collectProbeBilling,
  describeProbePricing,
  resolveBillingMode
} from "./billing/index.js";
import {
  runProbe,
  type Safe402ProbeReport
} from "./probe/index.js";
import {
  createJsonReport,
  formatAuditConsoleReport,
  formatAuditMarkdownReport,
  formatProbeConsoleReport,
  formatProbeMarkdownReport
} from "./reports/index.js";
import {
  AUDIT_HOSTED_REPORT_USD,
  AUDIT_MCP_SERVER_SCAN_USD,
  AUDIT_PRICING_USD,
  AUDIT_REQUEST_VARIANT_USD,
  PROBE_PRICE_USD,
  formatUsd
} from "./pricing.js";
import type { Safe402Policy } from "./types.js";

type Safe402Config = {
  policy?: Safe402Policy;
  endpoints?: string[];
  cases?: Safe402AuditCase[];
  probe?: {
    endpoints?: string[];
  };
  audit?: {
    cases?: Safe402AuditCase[];
    endpoints?: string[];
    profile?: Safe402AuditProfile;
    requestVariants?: number;
    mcpServers?: number;
    mcpManifests?: Safe402McpAuditManifest[];
    hostedReport?: boolean;
  };
};

type ProbeCliOptions = {
  endpoints: string[];
  method: string;
  headers: Record<string, string>;
  body?: string;
  policy: Safe402Policy;
  timeoutMs: number;
  billingMode: ReturnType<typeof resolveBillingMode>;
  outputPath?: string;
  failOn: Set<ProbeFailOn>;
};

type AuditCliOptions = {
  endpoints: string[];
  profile: Safe402AuditProfile;
  requestVariants: number;
  mcpServers: number;
  mcpManifests: Safe402McpAuditManifest[];
  hostedReport: boolean;
  policy: Safe402Policy;
  cases: Safe402AuditCase[];
  billingMode: ReturnType<typeof resolveBillingMode>;
  outputPath?: string;
  failOn: Set<AuditFailOn>;
};

type ProbeFailOn = "suspicious" | "blocked" | "approval" | "invalid";
type AuditFailOn = "warn" | "fail" | "critical";

const SUPPORTED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const DEFAULT_POLICY_PATH = "safe402.policy.json";
const DEFAULT_FAIL_ON: ProbeFailOn[] = ["suspicious", "blocked", "invalid"];
const CI_FAIL_ON: ProbeFailOn[] = ["suspicious", "blocked", "approval", "invalid"];
const DEFAULT_AUDIT_FAIL_ON: AuditFailOn[] = ["fail", "critical"];
const POLICY_INIT_DEFAULTS: Safe402Policy = {
  maxPaymentUsd: 0.25,
  dailyBudgetUsd: 10,
  allowedNetworks: ["base", "base-sepolia", "eip155:8453", "eip155:84532"],
  allowedAssets: ["USDC", "usdc", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
  requireApprovalAboveUsd: 1,
  blockSensitiveMetadata: true,
  duplicateWindowMs: 1_800_000
};

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "probe") {
  await runProbeCommand(args.slice(1)).catch(error => {
    console.error(error instanceof Error ? error.message : "Safe402 probe failed.");
    process.exitCode = 1;
  });
} else if (command === "audit") {
  await runAuditCommand(args.slice(1)).catch(error => {
    console.error(error instanceof Error ? error.message : "Safe402 audit failed.");
    process.exitCode = 1;
  });
} else if (command === "policy") {
  await runPolicyCommand(args.slice(1)).catch(error => {
    console.error(error instanceof Error ? error.message : "Safe402 policy command failed.");
    process.exitCode = 1;
  });
} else if (command === "pricing") {
  printPricing();
} else if (command === "version") {
  await printVersion().catch(error => {
    console.error(error instanceof Error ? error.message : "Safe402 version command failed.");
    process.exitCode = 1;
  });
} else {
  printHelp();
  process.exitCode = 1;
}

async function runProbeCommand(args: string[]) {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printProbeHelp();
    return;
  }

  const options = await parseProbeCliOptions(args);

  if (options.endpoints.length === 0) {
    printProbeHelp();
    process.exitCode = 1;
    return;
  }

  const billing = await collectProbeBilling({
    endpointChecks: options.endpoints.length,
    mode: options.billingMode
  });
  const report = await runProbe({
    policy: options.policy,
    endpoints: options.endpoints,
    timeoutMs: options.timeoutMs,
    requestInit: {
      method: options.method,
      headers: options.headers,
      body: options.body
    }
  });
  const reportWithBilling = { ...report, billing };

  await printReport(args, reportWithBilling, formatProbeConsoleReport, formatProbeMarkdownReport, options.outputPath);

  if (shouldFailProbe(report.probes, options.failOn)) {
    process.exitCode = 1;
  }
}

async function runAuditCommand(args: string[]) {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printAuditHelp();
    return;
  }

  if (args[0] === "quote") {
    const options = await parseAuditCliOptions(args.slice(1));
    const quote = quoteAudit(options);

    await printAuditQuote(args.slice(1), quote, options.outputPath);
    return;
  }

  const options = await parseAuditCliOptions(args);
  const quote = quoteAudit(options);
  const billing = await collectAuditBilling({
    quote,
    mode: options.billingMode
  });
  const report = await runAudit({
    policy: options.policy,
    endpoints: options.endpoints,
    cases: options.cases,
    profile: options.profile,
    requestVariants: options.requestVariants,
    mcpServers: options.mcpServers,
    mcpManifests: options.mcpManifests,
    hostedReport: options.hostedReport,
    quote,
    billing
  });

  await printReport(
    args,
    report,
    formatAuditConsoleReport,
    formatAuditMarkdownReport,
    options.outputPath,
    auditReport => shouldFailAudit((auditReport as Safe402AuditReport).checks, options.failOn)
  );
}

async function loadOptionalConfig(args: string[]): Promise<Safe402Config> {
  const configPath = readFlag(args, "--config") ?? readFlag(args, "-c");
  return configPath ? loadConfig(configPath) : {};
}

async function loadOptionalPolicy(path?: string): Promise<Safe402Policy> {
  return path ? loadPolicyFile(path) : {};
}

async function loadPolicyFile(path: string): Promise<Safe402Policy> {
  let parsed: Safe402Policy | { policy?: Safe402Policy };

  try {
    const contents = await readFile(path, "utf8");
    parsed = JSON.parse(contents) as Safe402Policy | { policy?: Safe402Policy };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Could not load Safe402 policy ${path}: ${reason}`);
  }

  if (isObject(parsed)) {
    const maybePolicy = (parsed as Record<string, unknown>)["policy"];

    if (isObject(maybePolicy)) {
      return maybePolicy as Safe402Policy;
    }
  }

  return parsed as Safe402Policy;
}

async function loadMcpManifestFile(path: string): Promise<Safe402McpAuditManifest> {
  try {
    const contents = await readFile(path, "utf8");
    return JSON.parse(contents) as Safe402McpAuditManifest;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Could not load MCP manifest ${path}: ${reason}`);
  }
}

async function loadConfig(path: string): Promise<Safe402Config> {
  let parsed: Safe402Config;

  try {
    const contents = await readFile(path, "utf8");
    parsed = JSON.parse(contents) as Safe402Config;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Could not load Safe402 config ${path}: ${reason}`);
  }

  return {
    policy: parsed.policy,
    endpoints: Array.isArray(parsed.endpoints) ? parsed.endpoints : [],
    cases: Array.isArray(parsed.cases) ? parsed.cases : [],
    probe: {
      endpoints: Array.isArray(parsed.probe?.endpoints) ? parsed.probe.endpoints : []
    },
    audit: {
      cases: Array.isArray(parsed.audit?.cases) ? parsed.audit.cases : [],
      endpoints: Array.isArray(parsed.audit?.endpoints) ? parsed.audit.endpoints : [],
      profile: parsed.audit?.profile,
      requestVariants: parsed.audit?.requestVariants,
      mcpServers: parsed.audit?.mcpServers,
      mcpManifests: Array.isArray(parsed.audit?.mcpManifests) ? parsed.audit.mcpManifests : [],
      hostedReport: parsed.audit?.hostedReport
    }
  };
}

async function parseProbeCliOptions(args: string[]): Promise<ProbeCliOptions> {
  const config = await loadOptionalConfig(args);
  const endpointFlags = readRepeatedFlag(args, "--url");
  const positionalEndpoints = readPositionals(args, new Set([
    "--url",
    "--config",
    "-c",
    "--method",
    "--header",
    "--body",
    "--body-file",
    "--policy",
    "--output",
    "--timeout",
    "--billing-mode",
    "--fail-on"
  ]));
  const method = (readFlag(args, "--method") ?? "GET").toUpperCase();
  const bodyFile = readFlag(args, "--body-file");
  const inlineBody = readFlag(args, "--body");
  const policyFile = readFlag(args, "--policy");
  const timeoutMs = Number(readFlag(args, "--timeout") ?? DEFAULT_PROBE_TIMEOUT_MS);
  const failOn = readFailOn(args);

  if (!SUPPORTED_METHODS.has(method)) {
    throw new Error(`--method must be one of ${Array.from(SUPPORTED_METHODS).join(", ")}.`);
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout must be a positive millisecond value.");
  }

  if (bodyFile && inlineBody !== undefined) {
    throw new Error("Use either --body or --body-file, not both.");
  }

  return {
    endpoints: [
      ...(config.probe?.endpoints ?? []),
      ...(config.endpoints ?? []),
      ...endpointFlags,
      ...positionalEndpoints
    ],
    method,
    headers: readHeaders(args),
    body: bodyFile ? await readFile(bodyFile, "utf8") : inlineBody,
    policy: {
      ...(config.policy ?? {}),
      ...(await loadOptionalPolicy(policyFile))
    },
    timeoutMs,
    billingMode: resolveBillingMode(readFlag(args, "--billing-mode")),
    outputPath: readFlag(args, "--output"),
    failOn
  };
}

async function parseAuditCliOptions(args: string[]): Promise<AuditCliOptions> {
  const config = await loadOptionalConfig(args);
  const endpointFlags = readRepeatedFlag(args, "--url");
  const positionalEndpoints = readPositionals(args, new Set([
    "--url",
    "--config",
    "-c",
    "--profile",
    "--policy",
    "--request-variant",
    "--variant",
    "--request-variants",
    "--mcp-manifest",
    "--mcp-server",
    "--mcp-servers",
    "--billing-mode",
    "--output",
    "--fail-on"
  ]));
  const policyFile = readFlag(args, "--policy");
  const mcpManifestPaths = readRepeatedFlag(args, "--mcp-manifest");
  const mcpManifests = [
    ...(config.audit?.mcpManifests ?? []),
    ...await Promise.all(mcpManifestPaths.map(loadMcpManifestFile))
  ];

  return {
    endpoints: [
      ...(config.audit?.endpoints ?? []),
      ...(config.endpoints ?? []),
      ...endpointFlags,
      ...positionalEndpoints
    ],
    profile: readAuditProfile(args, config.audit?.profile),
    requestVariants: readAuditRequestVariants(args, config.audit?.requestVariants),
    mcpServers: readAuditMcpServers(args, config.audit?.mcpServers),
    mcpManifests,
    hostedReport: hasFlag(args, "--hosted-report") || config.audit?.hostedReport === true,
    policy: {
      ...(config.policy ?? {}),
      ...(await loadOptionalPolicy(policyFile))
    },
    cases: [
      ...(config.audit?.cases ?? []),
      ...(config.cases ?? [])
    ],
    billingMode: resolveBillingMode(readFlag(args, "--billing-mode")),
    outputPath: readFlag(args, "--output"),
    failOn: readAuditFailOn(args)
  };
}

async function runPolicyCommand(args: string[]) {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printPolicyHelp();
    return;
  }

  const subcommand = args[0];

  if (subcommand !== "init") {
    printPolicyHelp();
    process.exitCode = 1;
    return;
  }

  const outputPath = readFlag(args.slice(1), "--output") ?? DEFAULT_POLICY_PATH;
  const force = hasFlag(args, "--force");

  if (!force && await fileExists(outputPath)) {
    throw new Error(`${outputPath} already exists. Use --force to overwrite it.`);
  }

  await writeFile(outputPath, `${JSON.stringify(POLICY_INIT_DEFAULTS, null, 2)}\n`, "utf8");
  console.log(`Created ${outputPath}`);
}

function printPricing() {
  console.log(`Safe402 pricing

Probe:
  ${formatUsd(PROBE_PRICE_USD)} per endpoint check

Audit:
  Basic: ${formatUsd(AUDIT_PRICING_USD.basic)} per endpoint
  Standard: ${formatUsd(AUDIT_PRICING_USD.standard)} per endpoint
  Deep: ${formatUsd(AUDIT_PRICING_USD.deep)} per endpoint
  Custom: quote-based

Audit add-ons:
  Request variant: ${formatUsd(AUDIT_REQUEST_VARIANT_USD)} each
  MCP tool manifest scan: ${formatUsd(AUDIT_MCP_SERVER_SCAN_USD)} per MCP server
  CI signed hosted report: ${formatUsd(AUDIT_HOSTED_REPORT_USD)} per report
`);
}

async function printVersion() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    name?: string;
    version?: string;
  };

  console.log(`${packageJson.name ?? "safe402"} ${packageJson.version ?? "unknown"}`);
  console.log(`node ${process.version}`);
  console.log(`platform ${process.platform}-${process.arch}`);
  console.log("build local");
}

async function printReport(
  args: string[],
  report: Safe402ProbeReport | Safe402AuditReport,
  formatter: (report: never) => string,
  markdownFormatter?: (report: never) => string,
  outputPath?: string,
  shouldFailReport?: (report: Safe402ProbeReport | Safe402AuditReport) => boolean
) {
  const output = hasFlag(args, "--json")
    ? JSON.stringify(createJsonReport(report), null, 2)
    : hasFlag(args, "--markdown")
      ? markdownFormatter ? markdownFormatter(report as never) : formatter(report as never)
      : formatter(report as never);

  if (outputPath) {
    await writeFile(outputPath, `${output}\n`, "utf8");
    console.log(`Wrote ${outputPath}`);
  } else {
    console.log(output);
  }

  if (shouldFailReport ? shouldFailReport(report) : report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function printAuditQuote(
  args: string[],
  quote: Safe402AuditQuote,
  outputPath?: string
) {
  const output = hasFlag(args, "--json")
    ? JSON.stringify(quote, null, 2)
    : formatAuditQuote(quote);

  if (outputPath) {
    await writeFile(outputPath, `${output}\n`, "utf8");
    console.log(`Wrote ${outputPath}`);
  } else {
    console.log(output);
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }

  return values;
}

function readPositionals(args: string[], valueFlags: Set<string>): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value.startsWith("-")) {
      index += valueFlags.has(value) ? flagArity(value, args, index) : 0;
      continue;
    }

    values.push(value);
  }

  return values;
}

function flagArity(flag: string, args: string[], index: number): number {
  if (flag === "--header") {
    const next = args[index + 1];
    const afterNext = args[index + 2];

    return next && afterNext && !afterNext.startsWith("-") && !next.includes(":")
      ? 2
      : 1;
  }

  return 1;
}

function readHeaders(args: string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--header") {
      continue;
    }

    const key = args[index + 1];
    const maybeValue = args[index + 2];

    if (!key) {
      throw new Error("--header requires a header name and value.");
    }

    if (key.includes(":")) {
      const separator = key.indexOf(":");
      const headerName = key.slice(0, separator).trim();
      const headerValue = key.slice(separator + 1).trim();

      if (!headerName) {
        throw new Error("--header requires a header name.");
      }

      headers[headerName] = headerValue;
      continue;
    }

    if (!maybeValue || maybeValue.startsWith("-")) {
      throw new Error("--header requires a header name and value.");
    }

    headers[key] = maybeValue;
    index += 2;
  }

  return headers;
}

function readAuditProfile(args: string[], defaultProfile: Safe402AuditProfile = "basic"): Safe402AuditProfile {
  const value = (readFlag(args, "--profile") ?? defaultProfile).toLowerCase();

  if (
    value === "basic" ||
    value === "standard" ||
    value === "deep" ||
    value === "custom"
  ) {
    return value;
  }

  throw new Error("--profile must be basic, standard, deep, or custom.");
}

function readAuditRequestVariants(args: string[], defaultCount = 0): number {
  const explicitCount = readFlag(args, "--request-variants");
  const repeatedCount = readRepeatedFlag(args, "--request-variant").length +
    readRepeatedFlag(args, "--variant").length;

  if (explicitCount === undefined) {
    return defaultCount + repeatedCount;
  }

  const parsedCount = Number(explicitCount);

  if (!Number.isInteger(parsedCount) || parsedCount < 0) {
    throw new Error("--request-variants must be a non-negative integer.");
  }

  return defaultCount + parsedCount + repeatedCount;
}

function readAuditMcpServers(args: string[], defaultCount = 0): number {
  const explicitCount = readFlag(args, "--mcp-servers");
  const repeatedCount = readRepeatedFlag(args, "--mcp-manifest").length +
    readRepeatedFlag(args, "--mcp-server").length;

  if (explicitCount === undefined) {
    return defaultCount + repeatedCount;
  }

  const parsedCount = Number(explicitCount);

  if (!Number.isInteger(parsedCount) || parsedCount < 0) {
    throw new Error("--mcp-servers must be a non-negative integer.");
  }

  return defaultCount + parsedCount + repeatedCount;
}

function readFailOn(args: string[]): Set<ProbeFailOn> {
  const values = hasFlag(args, "--ci")
    ? [...CI_FAIL_ON]
    : [...DEFAULT_FAIL_ON];

  for (const rawValue of readRepeatedFlag(args, "--fail-on")) {
    for (const value of rawValue.split(",")) {
      const normalized = value.trim().toLowerCase();

      if (!normalized) {
        continue;
      }

      if (!isProbeFailOn(normalized)) {
        throw new Error("--fail-on accepts suspicious, blocked, approval, or invalid.");
      }

      values.push(normalized);
    }
  }

  return new Set(values);
}

function readAuditFailOn(args: string[]): Set<AuditFailOn> {
  const explicitValues = readRepeatedFlag(args, "--fail-on");
  const values = explicitValues.length > 0
    ? []
    : [...DEFAULT_AUDIT_FAIL_ON];

  for (const rawValue of explicitValues) {
    for (const value of rawValue.split(",")) {
      const normalized = value.trim().toLowerCase();

      if (!normalized) {
        continue;
      }

      if (!isAuditFailOn(normalized)) {
        throw new Error("--fail-on accepts warn, fail, or critical for audit.");
      }

      values.push(normalized);
    }
  }

  return new Set(values);
}

function isProbeFailOn(value: string): value is ProbeFailOn {
  return value === "suspicious" ||
    value === "blocked" ||
    value === "approval" ||
    value === "invalid";
}

function isAuditFailOn(value: string): value is AuditFailOn {
  return value === "warn" ||
    value === "fail" ||
    value === "critical";
}

function shouldFailProbe(
  probes: Array<{ category: string }>,
  failOn: Set<ProbeFailOn>
): boolean {
  return probes.some(probe =>
    (probe.category === "SUSPICIOUS" && failOn.has("suspicious")) ||
    (probe.category === "BLOCKED_BY_POLICY" && failOn.has("blocked")) ||
    (probe.category === "NEEDS_APPROVAL" && failOn.has("approval")) ||
    (probe.category === "INVALID_X402" && failOn.has("invalid"))
  );
}

function shouldFailAudit(
  checks: Safe402AuditReport["checks"],
  failOn: Set<AuditFailOn>
): boolean {
  return checks.some(check =>
    (check.severity === "CRITICAL" && failOn.has("critical")) ||
    ((check.severity === "CRITICAL" || check.severity === "FAIL") && failOn.has("fail")) ||
    ((check.severity === "CRITICAL" || check.severity === "FAIL" || check.severity === "WARN") && failOn.has("warn"))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function printHelp() {
  console.log(`Safe402

Usage:
  safe402 probe https://api.example.com/paid
  safe402 probe --url https://api.example.com/paid
  safe402 probe --config safe402.config.json
  safe402 audit quote https://api.example.com/paid --profile standard
  safe402 audit https://api.example.com/paid --profile basic
  safe402 audit
  safe402 audit --config safe402.config.json
  safe402 policy init
  safe402 pricing
  safe402 version

Commands:
  probe      Unpaid x402 endpoint inspection and policy check
  audit      Simulated payment-flow safety checks before shipping
  policy     Create and manage Safe402 policy files
  pricing    Show Safe402 pricing
  version    Show package and runtime version info

Options:
  --url       Endpoint to probe without paying
  --config    Load policy, probe endpoints, and audit cases from JSON
  --policy    Load a standalone policy JSON file
  --json      Print machine-readable output
  --markdown  Print Markdown output when supported
  --help      Show help
`);
}

function printProbeHelp() {
  console.log(`Safe402 probe

Usage:
  safe402 probe https://api.example.com/paid
  safe402 probe --url https://api.example.com/paid
  safe402 probe --config safe402.config.json

Probe performs an unpaid fetch, extracts the x402 payment requirement, and checks it against policy.
It never requires a private key, signs payment data, or sends funds.

${describeProbePricing()}

Options:
  --method GET|POST|PUT|PATCH|DELETE
  --header key value
  --body '{"hello":"world"}'
  --body-file body.json
  --policy safe402.policy.json
  --output results.json
  --json
  --markdown
  --ci
  --fail-on suspicious,blocked,approval,invalid
  --timeout 15000
  --billing-mode disabled|mock|x402
`);
}

function printAuditHelp() {
  console.log(`Safe402 audit

Usage:
  safe402 audit quote https://api.example.com/paid --profile standard
  safe402 audit https://api.example.com/paid --profile basic
  safe402 audit https://api.example.com/paid --profile standard
  safe402 audit https://api.example.com/paid --profile deep
  safe402 audit
  safe402 audit --config safe402.config.json

Audit runs simulated x402 payment-flow failure scenarios. For live endpoint inspection, use safe402 probe.
Audit first calculates a quote, then runs the selected profile.

Options:
  --profile basic|standard|deep|custom
  --request-variant body.json
  --request-variants 2
  --mcp-manifest mcp.json
  --mcp-servers 1
  --hosted-report
  --billing-mode disabled|mock|x402
  --ci
  --fail-on warn,fail,critical
  --policy safe402.policy.json
  --json
  --markdown
  --output results.json
`);
}

function printPolicyHelp() {
  console.log(`Safe402 policy

Usage:
  safe402 policy init
  safe402 policy init --output safe402.policy.json

Creates a standalone Safe402 policy JSON file with conservative defaults.
`);
}
