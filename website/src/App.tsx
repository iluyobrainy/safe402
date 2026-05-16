import {
  ArrowsClockwise,
  CheckCircle,
  Circuitry,
  CodeBlock,
  Command,
  Database,
  FileText,
  Gauge,
  GitBranch,
  LockKey,
  PlugsConnected,
  Receipt,
  ShieldCheck,
  TerminalWindow,
  Warning
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type NavItem = {
  id: string;
  label: string;
};

type CommandScenario = {
  id: string;
  label: string;
  command: string;
  output: string[];
  expectation: string;
};

const navItems: NavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "audit", label: "Probe + Audit CLI" },
  { id: "sdk", label: "Runtime fuse" },
  { id: "mcp", label: "MCP wrapper" },
  { id: "policy", label: "Policy" },
  { id: "receipts", label: "Receipts" },
  { id: "production", label: "Production" }
];

const commandScenarios: CommandScenario[] = [
  {
    id: "probe",
    label: "Probe",
    command: "npx safe402 probe --url https://api.example.com/paid-data",
    output: [
      "Safe402 probe",
      "Checks: 2 passed, 0 failed, 0 warnings",
      "[pass] endpoint policy check",
      "[pass] endpoint metadata privacy"
    ],
    expectation: "Probe before paying: inspect the live x402 requirement without signing or sending funds."
  },
  {
    id: "audit",
    label: "Audit",
    command: "npx safe402 audit",
    output: [
      "Safe402 audit",
      "Checks: 14 passed, 0 failed, 0 warnings",
      "[pass] blocks changed recipient address",
      "[pass] blocks mutated retry body",
      "[pass] blocks missing PAYMENT-RESPONSE header",
      "[pass] blocks paid-but-denied responses",
      "[pass] blocks duplicate payment replay",
      "[pass] fingerprints payment intent"
    ],
    expectation: "Audit before shipping: simulate payment-flow failures before any x402 flow goes public."
  },
  {
    id: "sdk",
    label: "SDK",
    command: "npm install safe402",
    output: [
      "added safe402",
      "import { createSafe402Fetch } from \"safe402\"",
      "const safeFetch = createSafe402Fetch({ paidFetch, policy, receipts })"
    ],
    expectation: "Wrap raw paid fetch calls with a runtime fuse that can fail safely."
  },
  {
    id: "mcp",
    label: "MCP",
    command: "node mcp-server.js",
    output: [
      "registered safe402_check_payment",
      "registered safe402_pay_resource",
      "registered safe402_get_budget",
      "agent can inspect payment requirements before paying"
    ],
    expectation: "Expose payment checks as tools for agent runtimes that speak MCP."
  }
];

const policyRows = [
  ["maxPaymentUsd", "Stops a single call from costing more than the allowed amount."],
  ["dailyBudgetUsd", "Uses receipts to stop the agent from crossing a daily budget."],
  ["allowedDomains", "Keeps payment flows limited to known vendors and endpoints."],
  ["allowedNetworks", "Blocks chain mismatches before a wallet signs."],
  ["blockSensitiveMetadata", "Catches obvious emails, secrets, phone numbers, and risky query params."],
  ["blockPaymentIntentChanges", "Stops mutated retry bodies between challenge and payment."],
  ["requirePaymentResponseHeader", "Requires receipt proof after payment when your policy demands it."],
  ["duplicateWindowMs", "Prevents repeated payments to the same endpoint, payee, and amount."]
];

const receiptFields = [
  "status",
  "reason",
  "url",
  "domain",
  "amountUsd",
  "requirement",
  "duplicateKey",
  "timestamp",
  "responseStatus",
  "paymentResponse",
  "paymentIntent"
];

function App() {
  return (
    <div className="min-h-[100dvh] bg-[#090b0d] text-zinc-100 selection:bg-emerald-300 selection:text-zinc-950">
      <NoiseLayer />
      <TopBanner />
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_248px]">
        <Sidebar />
        <main className="min-w-0 border-x border-white/8">
          <Hero />
          <CommandLab />
          <QuickStart />
          <HowItWorks />
          <SdkSection />
          <McpSection />
          <PolicySection />
          <ReceiptsSection />
          <ProductionSection />
        </main>
        <OnThisPage />
      </div>
    </div>
  );
}

function TopBanner() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[#090b0d]/86 backdrop-blur-xl">
      <div className="mx-auto flex min-h-14 max-w-[1480px] items-center justify-between gap-4 px-4 md:px-6">
        <a className="flex items-center gap-3" href="#overview" aria-label="Safe402 home">
          <span className="grid size-8 place-items-center rounded-md border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">
            <ShieldCheck size={18} weight="duotone" />
          </span>
          <span className="text-sm font-semibold">Safe402</span>
        </a>
        <div className="hidden items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400 md:flex">
          <Command size={14} />
          <span>Docs for shippable x402 agent payments</span>
        </div>
        <a
          href="https://github.com/iluyobrainy/safe402"
          className="inline-flex items-center gap-2 rounded-md border border-white/12 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-emerald-300/40 hover:text-emerald-100 active:translate-y-[1px]"
        >
          <GitBranch size={14} />
          GitHub
        </a>
      </div>
    </header>
  );
}

function Sidebar() {
  return (
    <aside className="hidden lg:block">
      <nav className="sticky top-14 flex h-[calc(100dvh-3.5rem)] flex-col gap-7 overflow-y-auto px-5 py-8">
        <div>
          <p className="text-xs uppercase text-zinc-500">Documentation</p>
          <div className="mt-4 grid gap-1">
            {navItems.map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="rounded-md px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
        <div className="mt-auto rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs text-zinc-500">Install</p>
          <code className="mt-2 block rounded-md bg-zinc-950/80 px-3 py-2 text-xs text-emerald-200">npm install safe402</code>
        </div>
      </nav>
    </aside>
  );
}

function OnThisPage() {
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-14 h-[calc(100dvh-3.5rem)] overflow-y-auto px-5 py-8">
        <p className="text-xs uppercase text-zinc-500">On this page</p>
        <div className="mt-4 grid gap-3 text-sm">
          {navItems.map(item => (
            <a key={item.id} href={`#${item.id}`} className="text-zinc-500 transition hover:text-emerald-200">
              {item.label}
            </a>
          ))}
        </div>
        <div className="mt-8 border-t border-white/8 pt-5">
          <p className="text-xs text-zinc-500">Current package</p>
          <p className="mt-2 text-sm text-zinc-300">safe402@0.1.0</p>
        </div>
      </div>
    </aside>
  );
}

function Hero() {
  return (
    <section id="overview" className="relative overflow-hidden border-b border-white/8 px-4 py-16 md:px-8 md:py-24">
      <div className="grid gap-10 xl:grid-cols-[1.05fr_0.95fr] xl:items-center">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-md border border-emerald-300/20 bg-emerald-300/8 px-3 py-1.5 text-xs text-emerald-100">
            <Circuitry size={14} />
            Preflight and runtime safety for x402 agents
          </div>
          <h1 className="mt-7 max-w-4xl text-4xl font-semibold leading-[1.04] text-zinc-50 md:text-6xl">
            Safe402 makes x402 payments shippable.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
            Probe x402 endpoints before paying, audit payment flows before launch, then protect production
            agents with intent fingerprints, retry-loop fuses, metadata checks, and MCP-ready tool handlers.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#audit"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 active:translate-y-[1px]"
            >
              <TerminalWindow size={18} />
              Probe an endpoint
            </a>
            <a
              href="#sdk"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/12 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-emerald-300/40 hover:text-emerald-100 active:translate-y-[1px]"
            >
              <CodeBlock size={18} />
              Read the SDK guide
            </a>
          </div>
        </div>
        <HeroPanel />
      </div>
    </section>
  );
}

function HeroPanel() {
  return (
    <div className="relative">
      <div className="rounded-xl border border-white/10 bg-[#11151a] p-4 shadow-[0_24px_70px_-44px_rgba(16,185,129,0.45)]">
        <div className="flex items-center justify-between border-b border-white/8 pb-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-300" />
            <span className="text-xs text-zinc-400">safe402 runtime</span>
          </div>
          <span className="rounded bg-white/5 px-2 py-1 text-xs text-zinc-500">preflight and runtime</span>
        </div>
        <div className="grid gap-3 py-4">
          <FlowRow icon={<Gauge size={18} />} title="Probe preflight" detail="wrong chain, wrong asset, overprice" state="checked" />
          <FlowRow icon={<Receipt size={18} />} title="Receipt proof" detail="PAYMENT-RESPONSE required" state="verified" />
          <FlowRow icon={<ArrowsClockwise size={18} />} title="Runtime fuse" detail="retry loop and mutation stopped" state="blocked" />
          <FlowRow icon={<LockKey size={18} />} title="Privacy guard" detail="PII and private task data scanned" state="clean" />
        </div>
        <div className="rounded-lg border border-emerald-300/15 bg-emerald-300/8 p-4">
          <p className="text-sm text-emerald-100">x402 handles payment. Safe402 handles whether the flow is safe enough to ship.</p>
        </div>
      </div>
    </div>
  );
}

function FlowRow({ icon, title, detail, state }: { icon: React.ReactNode; title: string; detail: string; state: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-3">
      <div className="grid size-9 place-items-center rounded-md bg-white/[0.04] text-emerald-200">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm text-zinc-100">{title}</p>
        <p className="truncate text-xs text-zinc-500">{detail}</p>
      </div>
      <span className="rounded bg-zinc-950/70 px-2 py-1 text-xs text-zinc-400">{state}</span>
    </div>
  );
}

function CommandLab() {
  const [active, setActive] = useState(commandScenarios[0]);
  const [typed, setTyped] = useState("");
  const [showOutput, setShowOutput] = useState(0);

  useEffect(() => {
    setTyped("");
    setShowOutput(0);
    let index = 0;
    const typing = window.setInterval(() => {
      index += 1;
      setTyped(active.command.slice(0, index));
      if (index >= active.command.length) {
        window.clearInterval(typing);
        let line = 0;
        const output = window.setInterval(() => {
          line += 1;
          setShowOutput(line);
          if (line >= active.output.length) {
            window.clearInterval(output);
          }
        }, 460);
      }
    }, 42);

    return () => window.clearInterval(typing);
  }, [active]);

  return (
    <section id="audit" className="border-b border-white/8 px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="Interactive command line"
        title="Probe before paying. Audit before shipping."
        body="Safe402 is designed to be felt from the terminal first. Probe inspects what a live endpoint wants your agent to pay. Audit simulates failure scenarios and explains what passed, what failed, why, and how to fix it."
      />
      <div className="mt-10 grid gap-6 xl:grid-cols-[0.86fr_1.14fr]">
        <div className="grid content-start gap-3">
          {commandScenarios.map(scenario => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setActive(scenario)}
              className={`rounded-lg border p-4 text-left transition active:translate-y-[1px] ${
                active.id === scenario.id
                  ? "border-emerald-300/40 bg-emerald-300/8 text-emerald-50"
                  : "border-white/8 bg-white/[0.02] text-zinc-300 hover:border-white/16"
              }`}
            >
              <span className="text-sm font-semibold">{scenario.label}</span>
              <span className="mt-2 block text-sm leading-6 text-zinc-500">{scenario.expectation}</span>
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1116] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <TerminalWindow size={16} />
              terminal
            </div>
            <div className="flex gap-1.5">
              <span className="size-2 rounded-full bg-zinc-700" />
              <span className="size-2 rounded-full bg-zinc-700" />
              <span className="size-2 rounded-full bg-emerald-300" />
            </div>
          </div>
          <div className="min-h-[360px] p-5 font-mono text-sm leading-7">
            <p className="text-zinc-500">agent-dev@safe402</p>
            <p className="mt-2 text-zinc-100">
              <span className="text-emerald-300">$</span> {typed}
              <span className="terminal-cursor" />
            </p>
            <div className="mt-6 grid gap-2" aria-live="polite">
              {active.output.slice(0, showOutput).map(line => (
                <p key={line} className={line.includes("[pass]") ? "text-emerald-200" : "text-zinc-300"}>
                  {line}
                </p>
              ))}
            </div>
            {showOutput >= active.output.length && (
              <div className="mt-8 rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-4 font-sans text-sm leading-6 text-emerald-100">
                {active.expectation}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section className="border-b border-white/8 px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="Quick start"
        title="Add Safe402 where the agent would normally call paid fetch."
        body="The developer keeps their wallet, x402 client, payment fetch, and storage. Safe402 probes, audits, and enforces the rules passed into it."
      />
      <div className="mt-10 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <CodePanel
          title="safe-fetch.ts"
          code={`import { createMemoryReceiptStore, createSafe402Fetch } from "safe402";
import { wrapFetchWithPayment } from "@x402/fetch";

const paidFetch = wrapFetchWithPayment(fetch, x402Client);
const receipts = createMemoryReceiptStore();

export const safeFetch = createSafe402Fetch({
  fetch,
  paidFetch,
  receipts,
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    allowedDomains: ["api.example.com"],
    allowedNetworks: ["base-sepolia"],
    allowedAssets: ["USDC"],
    allowedPayTo: ["0x0000000000000000000000000000000000000000"],
    blockSensitiveMetadata: true,
    blockPaymentIntentChanges: true,
    requirePaymentResponseHeader: true
  }
});`}
        />
        <div className="grid gap-4">
          <InfoBlock icon={<ShieldCheck size={20} />} title="Before payment" body="Read the x402 requirement, parse amount, and decide whether the flow is safe enough to continue." />
          <InfoBlock icon={<Receipt size={20} />} title="After payment" body="Record the decision, response status, payment response header, and payment intent fingerprint." />
          <InfoBlock icon={<Warning size={20} />} title="When blocked" body="Throw a Safe402Error with an agent-readable reason and no wallet signature." />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["Request", "Agent calls an x402-protected URL through safeFetch."],
    ["Challenge", "The server replies with 402 Payment Required."],
    ["Decision", "Safe402 checks policy, receipts, amount, network, domain, payee, and metadata."],
    ["Payment", "Only approved requests reach the existing x402 paid fetch."],
    ["Verification", "Safe402 checks receipt headers, denial statuses, and repeated 402s after payment."],
    ["Memory", "Safe402 records receipts and intent fingerprints for debugging and replay protection."]
  ];

  return (
    <section className="border-b border-white/8 px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="Runtime model"
        title="A small fuse between the agent and a broken payment flow."
        body="Safe402 does not replace x402. It makes x402 payment calls safer to ship by adding preflight tests, intent memory, privacy checks, and clear failure states around the payment flow."
      />
      <div className="mt-10 grid gap-3">
        {steps.map(([title, body], index) => (
          <div key={title} className="grid gap-4 border-t border-white/8 py-5 md:grid-cols-[120px_1fr]">
            <span className="font-mono text-sm text-emerald-300">0{index + 1}</span>
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
              <p className="mt-2 max-w-3xl leading-7 text-zinc-400">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SdkSection() {
  return (
    <section id="sdk" className="border-b border-white/8 px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="SDK"
        title="The runtime fuse is intentionally small."
        body="Developers should be able to probe, audit, wrap, and explain x402 payment behavior without adopting a new payment platform."
      />
      <div className="mt-10 grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
          <h3 className="text-lg font-semibold">Public exports</h3>
          <div className="mt-5 grid gap-3 text-sm text-zinc-400">
            <MonoLine text="createSafe402Fetch" />
            <MonoLine text="createSafe402Probe" />
            <MonoLine text="runProbe" />
            <MonoLine text="createSafe402Audit" />
            <MonoLine text="runAudit" />
            <MonoLine text="Safe402Error" />
            <MonoLine text="evaluatePayment" />
            <MonoLine text="loadPolicy" />
            <MonoLine text="extractPaymentRequirement" />
            <MonoLine text="parseRequirementAmount" />
            <MonoLine text="createPaymentIntentFingerprint" />
            <MonoLine text="findSensitivePaymentMetadata" />
          </div>
        </div>
        <CodePanel
          title="handling-denials.ts"
          code={`import { Safe402Error } from "safe402";

try {
  const response = await safeFetch("https://api.example.com/paid-data");
  return await response.json();
} catch (error) {
  if (error instanceof Safe402Error) {
    return {
      blocked: true,
      reason: error.decision.reason,
      amountUsd: error.decision.amountUsd
    };
  }
  throw error;
}`}
        />
      </div>
    </section>
  );
}

function McpSection() {
  return (
    <section id="mcp" className="border-b border-white/8 px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="MCP wrapper"
        title="Expose Safe402 as tools for agent runtimes."
        body="The MCP wrapper is dependency-free. Register the handlers in your own MCP server or agent runtime."
      />
      <div className="mt-10 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <CodePanel
          title="mcp-tools.ts"
          code={`import { createMemoryReceiptStore } from "safe402";
import { createSafe402McpTools } from "safe402/mcp";

const tools = createSafe402McpTools({
  receipts: createMemoryReceiptStore(),
  policy: {
    maxPaymentUsd: 0.1,
    dailyBudgetUsd: 5,
    allowedDomains: ["api.example.com"],
    allowedNetworks: ["base-sepolia"],
    allowedAssets: ["USDC"]
  }
});

await tools.safe402_check_payment.handler({
  url: "https://api.example.com/paid-data",
  requirement
});`}
        />
        <div className="grid gap-3">
          <InfoBlock icon={<PlugsConnected size={20} />} title="safe402_check_payment" body="Evaluate a payment requirement before the agent asks the wallet to sign." />
          <InfoBlock icon={<TerminalWindow size={20} />} title="safe402_pay_resource" body="Fetch a paid resource through Safe402 policy checks." />
          <InfoBlock icon={<Database size={20} />} title="safe402_get_receipts" body="Expose the configured receipt store to agent workflows." />
          <InfoBlock icon={<Gauge size={20} />} title="safe402_get_budget" body="Return daily spend and remaining budget for the current store." />
        </div>
      </div>
    </section>
  );
}

function PolicySection() {
  return (
    <section id="policy" className="border-b border-white/8 px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="Policy"
        title="Rules stay in the developer's code, config, or database."
        body="Safe402 is local-first by default. It does not phone home to probe endpoints, audit flows, enforce policy, or store receipts."
      />
      <div className="mt-10 overflow-hidden rounded-xl border border-white/10">
        {policyRows.map(([field, body]) => (
          <div key={field} className="grid gap-3 border-b border-white/8 bg-white/[0.02] px-4 py-4 last:border-b-0 md:grid-cols-[240px_1fr]">
            <code className="font-mono text-sm text-emerald-200">{field}</code>
            <p className="text-sm leading-6 text-zinc-400">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReceiptsSection() {
  return (
    <section id="receipts" className="border-b border-white/8 px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="Receipts"
        title="Payment safety needs memory the developer can inspect."
        body="Receipts are not analytics decoration. Safe402 uses them to calculate spend, block duplicate attempts, trace payment intent, debug payment failures, and explain decisions."
      />
      <div className="mt-10 grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
          <h3 className="text-lg font-semibold">Receipt shape</h3>
          <div className="mt-5 flex flex-wrap gap-2">
            {receiptFields.map(field => (
              <span key={field} className="rounded-md border border-white/10 bg-zinc-950/70 px-2.5 py-1.5 font-mono text-xs text-zinc-300">
                {field}
              </span>
            ))}
          </div>
        </div>
        <CodePanel
          title="persistent-receipts.ts"
          code={`import { createJsonFileReceiptStore } from "safe402/node";

const receipts = createJsonFileReceiptStore({
  path: ".safe402/receipts.json"
});

const safeFetch = createSafe402Fetch({
  paidFetch,
  receipts,
  policy: {
    dailyBudgetUsd: 5,
    duplicateWindowMs: 30 * 60 * 1000
  }
});`}
        />
      </div>
    </section>
  );
}

function ProductionSection() {
  return (
    <section id="production" className="px-4 py-16 md:px-8 md:py-20">
      <SectionHeader
        eyebrow="Production"
        title="Ship with preflight tests, runtime fuses, and clear failure reasons."
        body="Safe402 gives developers a small toolchain they can run locally, in CI, and inside agent runtimes."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <InfoBlock icon={<CheckCircle size={20} />} title="CI ready" body="The CLI exits with code 1 on failed probe or audit checks and can run beside typecheck and tests." />
        <InfoBlock icon={<FileText size={20} />} title="Documented limits" body="Safe402 does not custody funds, create wallets, settle payments, proxy traffic, or guarantee vendor quality." />
        <InfoBlock icon={<LockKey size={20} />} title="Local-first" body="Policy and receipts stay in the developer's app unless they choose to connect a hosted store." />
        <InfoBlock icon={<ArrowsClockwise size={20} />} title="Runtime fuse" body="Repeated 402 responses after paid fetch are stopped before a silent payment loop forms." />
      </div>
    </section>
  );
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="max-w-4xl">
      <p className="text-xs uppercase text-emerald-300">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-50 md:text-4xl">{title}</h2>
      <p className="mt-4 max-w-3xl text-base leading-8 text-zinc-400">{body}</p>
    </div>
  );
}

function InfoBlock({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="grid size-10 place-items-center rounded-md bg-emerald-300/10 text-emerald-200">{icon}</div>
      <h3 className="mt-4 text-base font-semibold text-zinc-100">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
    </div>
  );
}

function CodePanel({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1116]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <CodeBlock size={16} />
          {title}
        </div>
        <span className="rounded bg-white/5 px-2 py-1 text-xs text-zinc-500">TypeScript</span>
      </div>
      <pre className="overflow-x-auto p-5 text-sm leading-7 text-zinc-300"><code>{code}</code></pre>
    </div>
  );
}

function MonoLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-white/8 bg-zinc-950/70 px-3 py-2">
      <span className="size-1.5 rounded-full bg-emerald-300" />
      <code className="font-mono text-xs text-zinc-300">{text}</code>
    </div>
  );
}

function NoiseLayer() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 opacity-[0.035]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
        backgroundSize: "18px 18px"
      }}
    />
  );
}

export { App };
