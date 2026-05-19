#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { formatAuditReport, runSafe402Audit, type Safe402AuditCase } from "./audit.js";
import type { Safe402Policy } from "./index.js";

type AuditConfig = {
  policy?: Safe402Policy;
  endpoints?: string[];
  cases?: Safe402AuditCase[];
};

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "audit") {
  await runAuditCommand(args.slice(1)).catch(error => {
    console.error(error instanceof Error ? error.message : "Safe402 audit failed.");
    process.exitCode = 1;
  });
} else {
  printHelp();
  process.exitCode = 1;
}

async function runAuditCommand(args: string[]) {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printHelp();
    return;
  }

  const configPath = readFlag(args, "--config") ?? readFlag(args, "-c");
  const endpointFlags = readRepeatedFlag(args, "--url");
  const json = hasFlag(args, "--json");

  const config = configPath ? await loadConfig(configPath) : {};
  const report = await runSafe402Audit({
    policy: config.policy,
    endpoints: [...(config.endpoints ?? []), ...endpointFlags],
    cases: config.cases
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAuditReport(report));
  }

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function loadConfig(path: string): Promise<AuditConfig> {
  let parsed: AuditConfig;

  try {
    const contents = await readFile(path, "utf8");
    parsed = JSON.parse(contents) as AuditConfig;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Could not load Safe402 config ${path}: ${reason}`);
  }

  return {
    policy: parsed.policy,
    endpoints: Array.isArray(parsed.endpoints) ? parsed.endpoints : [],
    cases: Array.isArray(parsed.cases) ? parsed.cases : []
  };
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

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function printHelp() {
  console.log(`Safe402

Usage:
  safe402 audit
  safe402 audit --url https://api.example.com/paid
  safe402 audit --config safe402.config.json

Options:
  --url       Preflight an x402 endpoint without paying
  --config    Load policy, endpoints, and custom cases from JSON
  --json      Print machine-readable audit output
  --help      Show this help
`);
}
