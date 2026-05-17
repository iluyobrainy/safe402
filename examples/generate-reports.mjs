import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAuditJsonReport,
  createProbeJsonReport,
  formatAuditMarkdownReport,
  formatProbeMarkdownReport,
  runProbe
} from "../dist/index.js";
import {
  formatAuditQuote,
  quoteAudit,
  runSafe402Audit
} from "../dist/audit.js";

const reportsDir = join(process.cwd(), "examples", "reports");
const generatedAt = "2026-05-17T00:00:00.000Z";
const requirement = {
  scheme: "exact",
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x0000000000000000000000000000000000000000",
  maxAmountRequired: "2000000",
  resource: "https://another-agent.com/paid-tool",
  description: "Paid tool access. Price is $2.00."
};

await mkdir(reportsDir, { recursive: true });

const probeReport = await runProbe({
  endpoints: ["https://another-agent.com/paid-tool"],
  policy: {
    maxPaymentUsd: 0.25,
    allowedDomains: ["another-agent.com"],
    allowedNetworks: ["base-sepolia"],
    allowedAssets: ["USDC"]
  },
  fetch: async () => new Response(JSON.stringify({ accepts: [requirement] }), { status: 402 })
});
const probeJson = createProbeJsonReport(probeReport, { generatedAt });

await writeJson("probe-blocked-policy.json", probeJson);
await writeText("probe-blocked-policy.md", formatProbeMarkdownReport({
  ...probeReport,
  generatedAt
}));

const auditQuote = quoteAudit({
  profile: "standard",
  endpoints: ["https://api.example.com/paid"]
});
const auditReport = await runSafe402Audit({
  profile: "standard"
});
const auditJson = createAuditJsonReport(auditReport, { generatedAt });

await writeJson("audit-standard-quote.json", auditQuote);
await writeText("audit-standard-quote.txt", formatAuditQuote(auditQuote));
await writeJson("audit-standard.json", auditJson);
await writeText("audit-standard.md", formatAuditMarkdownReport({
  ...auditReport,
  generatedAt
}));

console.log(`Generated Safe402 example reports in ${reportsDir}`);

async function writeJson(filename, value) {
  await writeText(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filename, value) {
  await writeFile(join(reportsDir, filename), value.endsWith("\n") ? value : `${value}\n`, "utf8");
}
