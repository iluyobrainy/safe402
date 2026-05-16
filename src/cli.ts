#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  formatAuditReport,
  runAudit,
  type Safe402AuditCase
} from "./audit/index.js";
import {
  formatProbeReport,
  runProbe
} from "./probe/index.js";
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
  };
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
} else {
  printHelp();
  process.exitCode = 1;
}

async function runProbeCommand(args: string[]) {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printProbeHelp();
    return;
  }

  const config = await loadOptionalConfig(args);
  const endpointFlags = readRepeatedFlag(args, "--url");
  const endpoints = [
    ...(config.probe?.endpoints ?? []),
    ...(config.endpoints ?? []),
    ...endpointFlags
  ];

  if (endpoints.length === 0) {
    printProbeHelp();
    process.exitCode = 1;
    return;
  }

  const report = await runProbe({
    policy: config.policy,
    endpoints
  });

  printReport(args, report, formatProbeReport);
}

async function runAuditCommand(args: string[]) {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printAuditHelp();
    return;
  }

  const config = await loadOptionalConfig(args);
  const endpointFlags = readRepeatedFlag(args, "--url");
  const report = await runAudit({
    policy: config.policy,
    endpoints: [
      ...(config.audit?.endpoints ?? []),
      ...(config.endpoints ?? []),
      ...endpointFlags
    ],
    cases: [
      ...(config.audit?.cases ?? []),
      ...(config.cases ?? [])
    ]
  });

  printReport(args, report, formatAuditReport);
}

async function loadOptionalConfig(args: string[]): Promise<Safe402Config> {
  const configPath = readFlag(args, "--config") ?? readFlag(args, "-c");
  return configPath ? loadConfig(configPath) : {};
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
      endpoints: Array.isArray(parsed.audit?.endpoints) ? parsed.audit.endpoints : []
    }
  };
}

function printReport<T extends { summary: { failed: number } }>(
  args: string[],
  report: T,
  formatter: (report: T) => string
) {
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatter(report));
  }

  if (report.summary.failed > 0) {
    process.exitCode = 1;
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

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function printHelp() {
  console.log(`Safe402

Usage:
  safe402 probe --url https://api.example.com/paid
  safe402 probe --config safe402.config.json
  safe402 audit
  safe402 audit --config safe402.config.json

Commands:
  probe      Unpaid x402 endpoint inspection and policy check
  audit      Simulated payment-flow safety checks before shipping

Options:
  --url       Endpoint to probe without paying
  --config    Load policy, probe endpoints, and audit cases from JSON
  --json      Print machine-readable output
  --help      Show help
`);
}

function printProbeHelp() {
  console.log(`Safe402 probe

Usage:
  safe402 probe --url https://api.example.com/paid
  safe402 probe --config safe402.config.json

Probe performs an unpaid fetch, extracts the x402 payment requirement, and checks it against policy.
`);
}

function printAuditHelp() {
  console.log(`Safe402 audit

Usage:
  safe402 audit
  safe402 audit --config safe402.config.json

Audit runs simulated x402 payment-flow failure scenarios. For live endpoint inspection, use safe402 probe.
`);
}
