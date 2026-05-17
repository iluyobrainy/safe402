import { createProbeJsonReport, runProbe } from "../dist/index.js";

const liveUrl = process.env.SAFE402_LIVE_URL;

if (!liveUrl) {
  console.log("Manual live test skipped. Set SAFE402_LIVE_URL to probe a real endpoint.");
  process.exit(0);
}

if (process.env.SAFE402_LIVE_CONFIRM !== "1") {
  console.error("Manual live test not confirmed. Set SAFE402_LIVE_CONFIRM=1 to run against SAFE402_LIVE_URL.");
  process.exit(1);
}

const report = await runProbe({
  endpoints: [liveUrl],
  policy: {
    maxPaymentUsd: Number(process.env.SAFE402_LIVE_MAX_USD ?? "0.01"),
    allowedNetworks: process.env.SAFE402_LIVE_ALLOWED_NETWORKS?.split(",").map(value => value.trim()).filter(Boolean),
    allowedAssets: process.env.SAFE402_LIVE_ALLOWED_ASSETS?.split(",").map(value => value.trim()).filter(Boolean),
    blockSensitiveMetadata: true
  }
});

console.log(JSON.stringify(createProbeJsonReport(report), null, 2));

if (report.summary.failed > 0) {
  process.exitCode = 1;
}
