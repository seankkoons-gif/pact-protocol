#!/usr/bin/env node
/**
 * create-pact-provider
 * 
 * Interactive scaffolding tool for creating Pact v3 provider projects.
 */

import { parse } from "minimist";
import { mkdir, writeFile, cp } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ProjectConfig {
  projectName: string;
  template: "express" | "worker" | "nextjs";
  settlement: "boundary" | "stripe" | "escrow";
  kya: "none" | "basic" | "zk";
}

/**
 * Prompt user for input using readline
 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for selection from options
 */
async function promptSelect<T extends string>(
  question: string,
  options: readonly T[],
  defaultIndex: number = 0
): Promise<T> {
  const optionsList = options.map((opt, idx) => `  ${idx + 1}. ${opt}`).join("\n");
  const promptText = `${question}\n${optionsList}\nSelect [${defaultIndex + 1}]: `;

  while (true) {
    const answer = await prompt(promptText);
    if (!answer) {
      return options[defaultIndex];
    }

    const index = parseInt(answer, 10) - 1;
    if (index >= 0 && index < options.length) {
      return options[index];
    }

    console.log(`❌ Invalid selection. Please choose 1-${options.length}`);
  }
}

/**
 * Collect project configuration via interactive prompts or CLI flags
 */
async function collectConfig(
  projectName: string | undefined,
  options: {
    template?: string;
    settlement?: string;
    kya?: string;
    yes?: boolean;
  } = {}
): Promise<ProjectConfig> {
  const config: Partial<ProjectConfig> = {};

  // Determine if we're in non-interactive mode
  const nonInteractive = options.yes || (options.template && options.settlement && options.kya);

  if (!nonInteractive) {
    console.log("\n🚀 Create Pact Provider\n");
  }

  // 1. Project name
  if (!projectName) {
    if (nonInteractive) {
      console.error("❌ Project name is required in non-interactive mode");
      process.exit(1);
    }
    const name = await prompt("Project name: ");
    if (!name) {
      console.error("❌ Project name is required");
      process.exit(1);
    }
    config.projectName = name;
  } else {
    config.projectName = projectName;
  }

  // 2. Template
  if (options.template) {
    const validTemplates = ["express", "worker", "nextjs"] as const;
    if (!validTemplates.includes(options.template as any)) {
      console.error(`❌ Invalid template: ${options.template}. Must be one of: ${validTemplates.join(", ")}`);
      process.exit(1);
    }
    config.template = options.template as "express" | "worker" | "nextjs";
  } else if (nonInteractive) {
    config.template = "express"; // Default in --yes mode
  } else {
    config.template = await promptSelect(
      "\nSelect template:",
      ["express", "worker", "nextjs"] as const,
      0
    );
  }

  // 3. Settlement mode
  if (options.settlement) {
    const validSettlements = ["boundary", "stripe", "escrow"] as const;
    if (!validSettlements.includes(options.settlement as any)) {
      console.error(`❌ Invalid settlement: ${options.settlement}. Must be one of: ${validSettlements.join(", ")}`);
      process.exit(1);
    }
    config.settlement = options.settlement as "boundary" | "stripe" | "escrow";
  } else if (nonInteractive) {
    config.settlement = "boundary"; // Default in --yes mode
  } else {
    config.settlement = await promptSelect(
      "\nSettlement mode:",
      ["boundary", "stripe", "escrow"] as const,
      0
    );
  }

  // 4. KYA requirement
  if (options.kya) {
    const validKya = ["none", "basic", "zk"] as const;
    if (!validKya.includes(options.kya as any)) {
      console.error(`❌ Invalid kya: ${options.kya}. Must be one of: ${validKya.join(", ")}`);
      process.exit(1);
    }
    config.kya = options.kya as "none" | "basic" | "zk";
  } else if (nonInteractive) {
    config.kya = "none"; // Default in --yes mode
  } else {
    const kyaOptions = ["none", "basic", "zk"] as const;
    config.kya = await promptSelect(
      "\nKYA requirement:",
      kyaOptions,
      0
    );
  }

  // Validation: zk KYA only works with boundary settlement
  if (config.kya === "zk" && config.settlement !== "boundary") {
    if (!nonInteractive) {
      console.log("\n⚠️  ZK-KYA is only supported with boundary settlement.");
      console.log("   Changing settlement mode to 'boundary'...");
    }
    config.settlement = "boundary";
  }

  return config as ProjectConfig;
}

/**
 * Create project from template
 */
async function createProject(config: ProjectConfig): Promise<void> {
  const projectPath = join(process.cwd(), config.projectName);
  const templateDir = join(__dirname, "..", "templates", config.template);

  // Check if template exists
  try {
    await mkdir(templateDir, { recursive: true });
  } catch {
    // Template directory should exist - templates will be created
  }

  console.log(`\n📦 Creating project: ${config.projectName}`);

  // Create project directory
  await mkdir(projectPath, { recursive: true });

  // Copy template files or generate from template config
  await generateTemplateFiles(projectPath, config);

  console.log(`✅ Project created in: ${projectPath}`);
  
  // Install dependencies (unless --no-install is set)
  if (!(config as any).noInstall) {
    const pmCmd = detectPackageManager();
    const pmInstall = `${pmCmd} install`;

    console.log(`\n📦 Installing dependencies with ${pmCmd}...`);

    try {
      execSync(pmInstall, { 
        cwd: projectPath, 
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "development" },
      });
      console.log(`✅ Dependencies installed`);
    } catch (error) {
      console.error(`\n⚠️  Failed to install dependencies. Run '${pmInstall}' manually.`);
    }
  }
  
  console.log(`\n🚀 Next steps:`);
  console.log(`   cd ${config.projectName}`);
  if (config.template === "nextjs") {
  console.log(`   ${pmCmd} run dev`);
  } else if (config.template === "worker") {
    console.log(`   ${pmCmd} run dev`);
  } else {
    console.log(`   ${pmCmd} run dev`);
  }
  console.log(`\n📖 See README.md for setup instructions`);
}

/**
 * Generate template files based on configuration
 */
async function generateTemplateFiles(projectPath: string, config: ProjectConfig): Promise<void> {
  // Generate package.json
  const packageJson = generatePackageJson(config);
  await writeFile(join(projectPath, "package.json"), packageJson, "utf-8");

  // Generate tsconfig.json
  const tsconfig = generateTsConfig(config);
  await writeFile(join(projectPath, "tsconfig.json"), tsconfig, "utf-8");

  // Generate .gitignore
  const gitignore = generateGitignore();
  await writeFile(join(projectPath, ".gitignore"), gitignore, "utf-8");

  // Generate source files based on template
  if (config.template === "express") {
    await generateExpressTemplate(projectPath, config);
  } else if (config.template === "worker") {
    await generateWorkerTemplate(projectPath, config);
  } else if (config.template === "nextjs") {
    await generateNextjsTemplate(projectPath, config);
  }

  // Generate README.md
  const readme = generateReadme(config);
  await writeFile(join(projectPath, "README.md"), readme, "utf-8");
}

/**
 * Generate Express template
 */
async function generateExpressTemplate(projectPath: string, config: ProjectConfig): Promise<void> {
  const srcDir = join(projectPath, "src");
  await mkdir(srcDir, { recursive: true });

  // server.ts
  const server = generateExpressServer();
  await writeFile(join(srcDir, "server.ts"), server, "utf-8");

  // pactHandler.ts
  const pactHandler = generatePactHandler(config);
  await writeFile(join(srcDir, "pactHandler.ts"), pactHandler, "utf-8");

  // policy.ts
  const policy = generatePolicy();
  await writeFile(join(srcDir, "policy.ts"), policy, "utf-8");

  // settlement.ts
  const settlement = generateSettlement(config);
  await writeFile(join(srcDir, "settlement.ts"), settlement, "utf-8");

  // kya.ts
  const kya = generateKya(config);
  await writeFile(join(srcDir, "kya.ts"), kya, "utf-8");
}

/**
 * Generate Worker template
 */
async function generateWorkerTemplate(projectPath: string, config: ProjectConfig): Promise<void> {
  const srcDir = join(projectPath, "src");
  await mkdir(srcDir, { recursive: true });

  // worker.ts
  const worker = generateWorkerIndex();
  await writeFile(join(srcDir, "worker.ts"), worker, "utf-8");

  // pactHandler.ts
  const pactHandler = generatePactHandler(config);
  await writeFile(join(srcDir, "pactHandler.ts"), pactHandler, "utf-8");

  // policy.ts
  const policy = generatePolicy();
  await writeFile(join(srcDir, "policy.ts"), policy, "utf-8");

  // settlement.ts
  const settlement = generateSettlement(config);
  await writeFile(join(srcDir, "settlement.ts"), settlement, "utf-8");

  // kya.ts
  const kya = generateKya(config);
  await writeFile(join(srcDir, "kya.ts"), kya, "utf-8");

  // wrangler.toml
  const wrangler = generateWrangler(config);
  await writeFile(join(projectPath, "wrangler.toml"), wrangler, "utf-8");
}

/**
 * Generate Next.js template
 */
async function generateNextjsTemplate(projectPath: string, config: ProjectConfig): Promise<void> {
  // app/api/pact/route.ts
  const apiDir = join(projectPath, "app", "api", "pact");
  await mkdir(apiDir, { recursive: true });

  const route = generateNextjsRoute(config);
  await writeFile(join(apiDir, "route.ts"), route, "utf-8");

  // src/pactHandler.ts
  const srcDir = join(projectPath, "src");
  await mkdir(srcDir, { recursive: true });
  const pactHandler = generatePactHandler(config);
  await writeFile(join(srcDir, "pactHandler.ts"), pactHandler, "utf-8");

  // src/policy.ts
  const policy = generatePolicy();
  await writeFile(join(srcDir, "policy.ts"), policy, "utf-8");

  // src/settlement.ts
  const settlement = generateSettlement(config);
  await writeFile(join(srcDir, "settlement.ts"), settlement, "utf-8");

  // src/kya.ts
  const kya = generateKya(config);
  await writeFile(join(srcDir, "kya.ts"), kya, "utf-8");

  // next.config.js
  const nextConfig = generateNextConfig();
  await writeFile(join(projectPath, "next.config.js"), nextConfig, "utf-8");
}

// Template generation functions (to be implemented)
function generatePackageJson(config: ProjectConfig): string {
  const deps: Record<string, string> = {
    "@pact/sdk": "^1.7.0",
  };

  const devDeps: Record<string, string> = {
    "@types/node": "^20.10.6",
    typescript: "^5.x",
  };

  const scripts: Record<string, string> = {};

  if (config.template === "express") {
    deps.express = "^4.18.2";
    devDeps["@types/express"] = "^4.17.21";
    devDeps.tsx = "^4.21.0";
    scripts.dev = "tsx src/server.ts";
    scripts.build = "tsc";
    scripts.start = "node dist/server.js";
  } else if (config.template === "worker") {
    devDeps["@cloudflare/workers-types"] = "^4.20231121.0";
    devDeps.wrangler = "^3.19.0";
    scripts.dev = "wrangler dev";
    scripts.deploy = "wrangler deploy";
  } else if (config.template === "nextjs") {
    deps.next = "^14.0.0";
    deps.react = "^18.2.0";
    deps["react-dom"] = "^18.2.0";
    devDeps["@types/react"] = "^18.2.0";
    devDeps["@types/react-dom"] = "^18.2.0";
    scripts.dev = "next dev";
    scripts.build = "next build";
    scripts.start = "next start";
  }

  if (config.settlement === "stripe") {
    deps.stripe = "^14.0.0";
  }

  if (config.settlement === "escrow") {
    deps.ethers = "^6.0.0";
  }

  return JSON.stringify(
    {
      name: config.projectName,
    version: "0.1.0",
    type: "module",
      scripts,
      dependencies: deps,
      devDependencies: devDeps,
    },
    null,
    2
  );
}

function generateTsConfig(config: ProjectConfig): string {
  const compilerOptions: any = {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022"],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
  };

  if (config.template === "nextjs") {
    compilerOptions.jsx = "preserve";
    compilerOptions.paths = {
      "@/*": ["./*"]
    };
  } else if (config.template === "worker") {
    compilerOptions.types = ["@cloudflare/workers-types"];
  } else {
    compilerOptions.outDir = "./dist";
    compilerOptions.rootDir = "./src";
  }

  const base = {
    compilerOptions,
    include: config.template === "nextjs" ? ["next-env.d.ts", "**/*.ts", "**/*.tsx"] : ["src/**/*"],
    exclude: ["node_modules"],
  };

  return JSON.stringify(base, null, 2);
}

function generateGitignore(): string {
  return `node_modules/
dist/
.pact/
*.log
.env
.DS_Store
.next/
.vercel/
`;
}

function generateExpressServer(): string {
  return `import express from "express";
import { handlePactRequest } from "./pactHandler.js";
import { ensureTranscriptDir } from "./pactHandler.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Middleware
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    ok: true, 
    service: "pact-provider",
    version: "0.1.0"
  });
});

// Pact protocol endpoint
app.post("/pact", async (req, res) => {
  try {
    // Ensure transcript directory exists
    ensureTranscriptDir();
    
    const request = req.body;
    const response = await handlePactRequest(request);
    
    res.json(response);
  } catch (error: any) {
    console.error("[Server] Error handling Pact request:", error.message);
    res.status(400).json({ 
      error: error.message || "Bad request" 
    });
  }
});

app.listen(PORT, () => {
  console.log(\`\n🚀 Pact Provider Server\`);
  console.log(\`   Listening on http://localhost:\${PORT}\`);
  console.log(\`   Health: http://localhost:\${PORT}/health\`);
  console.log(\`   Pact:   http://localhost:\${PORT}/pact\n\`);
});
`;
}

function generateWorkerIndex(): string {
  return `import { handlePactRequest } from "./pactHandler.js";

export interface Env {
  // Cloudflare Worker environment bindings
  // NEGOTIATIONS?: KVNamespace;
  // PROVIDER_SECRET?: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
  }

  // Health check
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "pact-provider" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
  }

  // Pact protocol endpoint
    if (request.method === "POST" && new URL(request.url).pathname === "/pact") {
      try {
        const envelope = await request.json();
        const response = await handlePactRequest(envelope, env);
        
        return new Response(
          JSON.stringify(response),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("[Worker] Error:", error.message);
        return new Response(
          JSON.stringify({ error: error.message || "Bad request" }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400
          }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404
      }
    );
  },
};
`;
}

function generateNextjsRoute(config: ProjectConfig): string {
  return `import { NextRequest, NextResponse } from "next/server";
import { handlePactRequest, ensureTranscriptDir } from "@/src/pactHandler";

/**
 * POST /api/pact - Handle Pact negotiation requests
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Ensure transcript directory exists
    ensureTranscriptDir();
    
    const envelope = await request.json();
    const response = await handlePactRequest(envelope);

    return NextResponse.json(response);
      } catch (error: any) {
    console.error("[Pact API] Error:", error.message);
    return NextResponse.json(
      { error: error.message || "Bad request" },
      { status: 400 }
    );
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
`;
}

function generateNextConfig(): string {
  return `/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable ESM support
  experimental: {
    esmExternals: true,
  },
};

module.exports = nextConfig;
`;
}

function generateWrangler(config: ProjectConfig): string {
  return `name = "${config.projectName}"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

[build]
command = ""

# Environment variables (set via \`wrangler secret put\`)
# [vars]
# PROVIDER_SECRET = "your-secret-here"
`;
}

function generatePactHandler(config: ProjectConfig): string {
  const fsImports = config.template === "worker" 
    ? ""
    : `import * as fs from "node:fs";
import * as path from "node:path";
`;

  const transcriptEmit = config.template === "worker" 
    ? `/**
 * Emit transcript (Cloudflare Workers - logs to console)
 * 
 * Note: Cloudflare Workers don't support file system access.
 * In production, store transcripts in KV or send to external service.
 */
function emitTranscript(message: ParsedPactMessage): void {
  const transcript = {
    timestamp: new Date().toISOString(),
    provider_id: providerId.substring(0, 16) + "...",
    message_type: message.type,
    intent_id: "intent_id" in message ? message.intent_id : undefined,
    price: "price" in message ? message.price : ("agreed_price" in message ? message.agreed_price : undefined),
  };

  // Log transcript (in production: store in KV or send to external service)
  console.log(\`📄 Transcript: \${JSON.stringify(transcript, null, 2)}\`);
}`
    : `// Transcript directory
const TRANSCRIPT_DIR = path.join(process.cwd(), ".pact", "transcripts");

/**
 * Ensure transcript directory exists
 */
export function ensureTranscriptDir(): void {
  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  }
}

/**
 * Emit transcript to .pact/transcripts directory
 */
function emitTranscript(message: ParsedPactMessage): void {
  ensureTranscriptDir();
  
  const transcript = {
    timestamp: new Date().toISOString(),
    provider_id: providerId.substring(0, 16) + "...",
    message_type: message.type,
    intent_id: "intent_id" in message ? message.intent_id : undefined,
    price: "price" in message ? message.price : ("agreed_price" in message ? message.agreed_price : undefined),
  };

  // Save transcript JSON file
  const filename = \`intent-\${transcript.intent_id || "unknown"}-\${Date.now()}.json\`;
  const filepath = path.join(TRANSCRIPT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(transcript, null, 2));

  // Print transcript path (required by constraints)
  console.log(\`📄 Transcript: \${filepath}\`);
}`;

  return `/**
 * Pact Protocol Handler
 * 
 * Uses @pact/sdk to handle protocol messages. This is PACT LOGIC - uses SDK APIs only.
 */

import type { SignedEnvelope, ParsedPactMessage, IntentMessage, AskMessage, AcceptMessage, RejectMessage } from "@pact/sdk";
import { 
  parseEnvelope, 
  signEnvelope, 
  generateKeyPair,
  DefaultPolicyGuard,
  createDefaultPolicy,
  validatePolicyJson
} from "@pact/sdk";
import { defaultPolicy } from "./policy.js";
${config.template === "worker" ? `import type { Env } from "./worker.js";` : ""}
${fsImports}
${transcriptEmit}

// Provider identity (in production: load from secure storage)
const providerKeypair = generateKeyPair();
const providerId = Buffer.from(providerKeypair.publicKey).toString("base64");

// Policy guard for validation (uses policy from policy.ts)
const policyValidation = validatePolicyJson(defaultPolicy);
if (!policyValidation.ok) {
  throw new Error(\`Policy validation failed: \${JSON.stringify(policyValidation.errors)}\`);
}
const policyGuard = new DefaultPolicyGuard(policyValidation.policy);

/**
 * Main handler for Pact protocol requests
 */
export async function handlePactRequest(
  envelope: SignedEnvelope${config.template === "worker" ? `,\n  env?: Env` : ""}
): Promise<SignedEnvelope> {
${config.template !== "worker" ? `  // Ensure transcript directory exists
  ensureTranscriptDir();
  ` : ""}
  // Parse and validate envelope (SDK handles protocol validation)
  const parsed = await parseEnvelope(envelope);
  
  // Emit transcript to .pact/transcripts
  emitTranscript(parsed.message);
  
  // Route by message type
  switch (parsed.message.type) {
    case "INTENT":
      return handleIntent(parsed.message as IntentMessage);
    
    case "BID":
      return handleBid(parsed.message as any);
    
    case "ACCEPT":
      return handleAccept(parsed.message as AcceptMessage);
    
    case "REJECT":
      return handleReject(parsed.message as RejectMessage);
    
    default:
      throw new Error(\`Unsupported message type: \${parsed.message.type}\`);
  }
}

/**
 * Handle INTENT message - generate ASK quote
 */
async function handleIntent(intent: IntentMessage): Promise<SignedEnvelope> {
  // Validate intent against policy (SDK handles policy enforcement)
  const intentContext = {
    intent_type: intent.intent,
    max_price: intent.max_price,
    constraints: intent.constraints,
    expires_at_ms: intent.expires_at_ms,
    sent_at_ms: intent.sent_at_ms,
    protocol_version: intent.protocol_version,
  };
  
  const validation = policyGuard.checkIntent(intentContext);
  if (!validation.ok) {
    throw new Error(\`Intent validation failed: \${validation.code}\`);
  }
  
  // Provider-specific pricing logic (YOUR LOGIC HERE)
  const basePrice = 0.00008; // Default price
  const price = Math.min(basePrice, intent.max_price);
  
  if (price > intent.max_price) {
    throw new Error(\`Price \${price} exceeds max_price \${intent.max_price}\`);
  }
  
  const nowMs = Date.now();
  const validForMs = 20000; // Quote valid for 20 seconds
  
  // Build ASK message (protocol-defined structure)
  const askMessage: AskMessage = {
    protocol_version: "pact/1.0",
    type: "ASK",
    intent_id: intent.intent_id,
    price,
    unit: "request",
    latency_ms: intent.constraints.latency_ms,
    valid_for_ms: validForMs,
    bond_required: Math.max(0.00001, price * 2),
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + validForMs,
  };
  
  // Sign response (SDK handles cryptographic signing)
  return await signEnvelope(askMessage, providerKeypair, nowMs);
}

/**
 * Handle BID message - respond with updated ASK or ACCEPT
 */
async function handleBid(bid: any): Promise<SignedEnvelope> {
  // Simple strategy: Accept if bid is reasonable
  const basePrice = 0.00008;
  
  if (bid.price >= basePrice * 0.8) {
    // Accept the bid
    const nowMs = Date.now();
    const acceptMessage: AcceptMessage = {
      protocol_version: "pact/1.0",
      type: "ACCEPT",
      intent_id: bid.intent_id,
      agreed_price: bid.price,
      settlement_mode: "${config.settlement === "boundary" ? "hash_reveal" : config.settlement}",
      proof_type: "hash_reveal",
      challenge_window_ms: 100,
      delivery_deadline_ms: nowMs + 60000,
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 30000,
    };
    
    return await signEnvelope(acceptMessage, providerKeypair, nowMs);
  } else {
    // Counter with new ASK
    const counterPrice = Math.min(basePrice * 0.95, bid.price * 1.1);
    
    const nowMs = Date.now();
    const askMessage: AskMessage = {
      protocol_version: "pact/1.0",
      type: "ASK",
      intent_id: bid.intent_id,
      price: counterPrice,
      unit: "request",
      latency_ms: bid.latency_ms || 50,
      valid_for_ms: 20000,
      bond_required: Math.max(0.00001, counterPrice * 2),
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 20000,
    };
    
    return await signEnvelope(askMessage, providerKeypair, nowMs);
  }
}

/**
 * Handle ACCEPT message - prepare settlement
 */
async function handleAccept(accept: AcceptMessage): Promise<SignedEnvelope> {
  // Settlement is handled by settlement.ts module
  // This is just acknowledgment
  
  const nowMs = Date.now();
  const acceptAck: AcceptMessage = {
    protocol_version: "pact/1.0",
    type: "ACCEPT",
    intent_id: accept.intent_id,
    agreed_price: accept.agreed_price,
    settlement_mode: accept.settlement_mode,
    proof_type: accept.proof_type,
    challenge_window_ms: accept.challenge_window_ms,
    delivery_deadline_ms: accept.delivery_deadline_ms,
    sent_at_ms: nowMs,
    expires_at_ms: accept.expires_at_ms,
  };
  
  return await signEnvelope(acceptAck, providerKeypair, nowMs);
}

/**
 * Handle REJECT message - cleanup
 */
async function handleReject(reject: RejectMessage): Promise<SignedEnvelope> {
  const nowMs = Date.now();
  const rejectAck: RejectMessage = {
    protocol_version: "pact/1.0",
    type: "REJECT",
    intent_id: reject.intent_id,
    reason: reject.reason || "Negotiation rejected",
    code: reject.code,
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + 30000,
  };
  
  return await signEnvelope(rejectAck, providerKeypair, nowMs);
}
`;
}

function generatePolicy(): string {
  return `/**
 * Negotiation Policy
 * 
 * Configures negotiation constraints and rules using Pact SDK policy types.
 */

import type { PactPolicy } from "@pact/sdk";
import { createDefaultPolicy } from "@pact/sdk";

/**
 * Default provider policy
 * 
 * Customize this based on your requirements:
 * - Negotiation rounds
 * - Reputation thresholds
 * - SLA constraints
 * - Settlement modes
 */
export const defaultPolicy: PactPolicy = createDefaultPolicy();

// Example: Relax policy for demo (allow any reputation)
// defaultPolicy.counterparty.min_reputation = 0.0;
`;
}

function generateSettlement(config: ProjectConfig): string {
  if (config.settlement === "stripe") {
    return `/**
 * Settlement Adapter - Stripe Integration
 * 
 * Uses @pact/sdk StripeSettlementProvider when stripe package is installed.
 */

import { StripeSettlementProvider, validateStripeConfig } from "@pact/sdk";

// Initialize Stripe settlement provider (optional dependency)
let settlementProvider: StripeSettlementProvider | null = null;

try {
  const config = validateStripeConfig({
    mode: process.env.PACT_STRIPE_MODE === "live" ? "live" : "sandbox",
    enabled: true, // Enable if stripe package is installed
  });
  
  if (config.ok) {
    settlementProvider = new StripeSettlementProvider(config.config);
    console.log("[Settlement] Stripe provider initialized");
  }
} catch (error) {
  console.log("[Settlement] Stripe not available (stripe package not installed)");
}

/**
 * Prepare settlement (lock funds)
 */
export async function prepareSettlement(params: {
  intentId: string;
  amount: number;
  bondAmount: number;
}): Promise<string> {
  if (settlementProvider) {
    // Use Stripe settlement
    // Implementation depends on SDK settlement API
    console.log(\`[Settlement] Preparing Stripe settlement: \${params.intentId}\`);
    return \`stripe-\${params.intentId}-\${Date.now()}\`;
  } else {
    // Fallback to boundary mode
    console.log(\`[Settlement] Boundary mode (no settlement): \${params.intentId}\`);
    return \`boundary-\${params.intentId}-\${Date.now()}\`;
  }
}

/**
 * Commit settlement (release funds)
 */
export async function commitSettlement(params: {
  handleId: string;
  proof: string;
}): Promise<void> {
  if (settlementProvider) {
    console.log(\`[Settlement] Committing Stripe settlement: \${params.handleId}\`);
  } else {
    console.log(\`[Settlement] Boundary mode commit: \${params.handleId}\`);
  }
}
`;
  } else if (config.settlement === "escrow") {
  return `/**
 * Settlement Adapter - Escrow Integration
 * 
 * Implements escrow settlement for on-chain execution.
 * Replace with your actual escrow contract integration.
 */

/**
 * Prepare settlement (lock funds in escrow)
 */
export async function prepareSettlement(params: {
  intentId: string;
  amount: number;
  bondAmount: number;
}): Promise<string> {
  // TODO: Implement escrow contract lock
  // Example:
  // const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
  // const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  // const escrow = new ethers.Contract(ESCROW_ADDRESS, EscrowABI, wallet);
  // const tx = await escrow.lock(params.intentId, params.amount);
  
  console.log(\`[Settlement] Preparing escrow: \${params.intentId}\`);
  return \`escrow-\${params.intentId}-\${Date.now()}\`;
}

/**
 * Commit settlement (release funds from escrow)
 */
export async function commitSettlement(params: {
  handleId: string;
  proof: string;
}): Promise<void> {
  // TODO: Implement escrow contract release
  // const tx = await escrow.release(params.handleId, params.proof);
  
  console.log(\`[Settlement] Committing escrow: \${params.handleId}\`);
}
`;
  } else {
    return `/**
 * Settlement Adapter - Boundary Mode (Default)
 * 
 * Boundary mode: Settlement is handled externally or in-memory for testing.
 * This is the default mode and requires no additional dependencies.
 */

/**
 * Prepare settlement (boundary mode - no actual locking)
 */
export async function prepareSettlement(params: {
  intentId: string;
  amount: number;
  bondAmount: number;
}): Promise<string> {
  // Boundary mode: Settlement is handled externally or by SDK
  // This is just a placeholder for logging
  console.log(\`[Settlement] Boundary mode: intentId=\${params.intentId}, amount=\${params.amount}\`);
  return \`boundary-\${params.intentId}-\${Date.now()}\`;
}

/**
 * Commit settlement (boundary mode)
 */
export async function commitSettlement(params: {
  handleId: string;
  proof: string;
}): Promise<void> {
  // Boundary mode: Settlement committed externally or by SDK
  console.log(\`[Settlement] Boundary mode commit: handleId=\${params.handleId}\`);
}
`;
  }
}

function generateKya(config: ProjectConfig): string {
  if (config.kya === "zk") {
  return `/**
 * KYA (Know Your Agent) Verification - ZK-KYA
 * 
 * Uses @pact/sdk DefaultZkKyaVerifier when snarkjs package is installed.
 */

import { DefaultZkKyaVerifier } from "@pact/sdk";

// Initialize ZK-KYA verifier (optional dependency)
let zkKyaVerifier: DefaultZkKyaVerifier | null = null;

try {
  zkKyaVerifier = new DefaultZkKyaVerifier();
  console.log("[KYA] ZK-KYA verifier initialized");
} catch (error) {
  console.log("[KYA] ZK-KYA not available (snarkjs package not installed)");
}

/**
 * Verify agent KYA credentials with ZK proof
 */
export async function verifyKya(params: {
  agentId: string;
  zkProof?: any;
}): Promise<{ ok: boolean; tier?: string; reason?: string }> {
  if (!zkKyaVerifier) {
    return { ok: false, reason: "ZK-KYA verifier not available" };
  }

  if (!params.zkProof) {
    return { ok: false, reason: "ZK-KYA proof required" };
  }

  // TODO: Use verifier.verify() when SDK API is available
  // const result = await zkKyaVerifier.verify(params.zkProof);
  // return result;

  console.log(\`[KYA] Verifying ZK-KYA proof for agent: \${params.agentId}\`);
  return { ok: true, tier: "trusted" };
}
`;
  } else if (config.kya === "basic") {
    return `/**
 * KYA (Know Your Agent) Verification - Basic
 * 
 * Basic credential verification without ZK proofs.
 */

/**
 * Verify agent KYA credentials
 */
export async function verifyKya(params: {
  agentId: string;
  credentials?: string[];
}): Promise<{ ok: boolean; tier?: string; reason?: string }> {
  // Basic verification: check if agent has required credentials
  // In production, verify credentials against issuer registry
  
  console.log(\`[KYA] Verifying agent: \${params.agentId}\`);
  
  // Stub: Accept all agents with credentials
  if (params.credentials && params.credentials.length > 0) {
    return { ok: true, tier: "verified" };
  }
  
  return { ok: true, tier: "unknown" };
}
`;
  } else {
    return `/**
 * KYA (Know Your Agent) Verification - None
 * 
 * No KYA verification required. All agents are accepted.
 */

/**
 * Verify agent KYA credentials (no-op)
 */
export async function verifyKya(params: {
  agentId: string;
  credentials?: any;
}): Promise<{ ok: boolean; tier?: string }> {
  // No KYA verification - accept all agents
  return { ok: true, tier: "unknown" };
}
`;
  }
}

function generateReadme(config: ProjectConfig): string {
  const pmCmd = detectPackageManager();
  const templateName = config.template.charAt(0).toUpperCase() + config.template.slice(1);

  let setupInstructions = "";
  let testInstructions = "";

  if (config.template === "express") {
    setupInstructions = `## 5-Minute Setup

1. **Install dependencies** (if not already installed):
   \`\`\`bash
   ${pmCmd} install
   \`\`\`

2. **Start the provider**:
   \`\`\`bash
   ${pmCmd} run dev
   \`\`\`

   The provider will start on \`http://localhost:3000\`

3. **Test the provider**:
   \`\`\`bash
   curl http://localhost:3000/health
   \`\`\`

   Test the Pact endpoint:
   \`\`\`bash
   curl -X POST http://localhost:3000/pact \\
     -H "Content-Type: application/json" \\
     -d '{
       "envelope_version": "pact-envelope/1.0",
       "message": {
         "protocol_version": "pact/1.0",
         "type": "INTENT",
         "intent_id": "test-intent-1",
         "intent": "weather.data",
         "scope": "NYC",
         "constraints": { "latency_ms": 50, "freshness_sec": 10 },
         "max_price": 0.0002,
         "settlement_mode": "hash_reveal",
         "sent_at_ms": ${Date.now()},
         "expires_at_ms": ${Date.now() + 60000}
       },
       "message_hash_hex": "test",
       "signer_public_key_b58": "test",
       "signature_b58": "test",
       "signed_at_ms": ${Date.now()}
     }'
   \`\`\`

   **Expected output:** A signed ASK message and a transcript file created in \`.pact/transcripts/\`.`;
  } else if (config.template === "worker") {
    setupInstructions = `## 5-Minute Setup

1. **Install dependencies**:
   \`\`\`bash
   ${pmCmd} install
   \`\`\`

2. **Start the provider locally**:
   \`\`\`bash
   ${pmCmd} run dev
   \`\`\`

   The provider will start on \`http://localhost:8787\`

3. **Test the provider**:
   \`\`\`bash
   curl http://localhost:8787/health
   \`\`\``;
  } else {
    setupInstructions = `## 5-Minute Setup

1. **Install dependencies**:
   \`\`\`bash
   ${pmCmd} install
   \`\`\`

2. **Start the provider**:
   \`\`\`bash
   ${pmCmd} run dev
   \`\`\`

   The provider will start on \`http://localhost:3000\`

3. **Test the Pact endpoint**:
   \`\`\`bash
   curl -X POST http://localhost:3000/api/pact \\
     -H "Content-Type: application/json" \\
     -d '{
       "envelope_version": "pact-envelope/1.0",
       "message": {
         "protocol_version": "pact/1.0",
         "type": "INTENT",
         "intent_id": "test-intent-1",
         "intent": "weather.data",
         "scope": "NYC",
         "constraints": { "latency_ms": 50, "freshness_sec": 10 },
         "max_price": 0.0002,
         "settlement_mode": "hash_reveal",
         "sent_at_ms": ${Date.now()},
         "expires_at_ms": ${Date.now() + 60000}
       },
       "message_hash_hex": "test",
       "signer_public_key_b58": "test",
       "signature_b58": "test",
       "signed_at_ms": ${Date.now()}
     }'
   \`\`\`

   **Expected output:** A signed ASK message and a transcript file created in \`.pact/transcripts/\`.`;
  }

  return `# ${config.projectName}

A ${templateName} Pact v3 provider implementation.

${setupInstructions}

## Project Structure

- \`src/pactHandler.ts\` - Pact protocol handler (uses @pact/sdk)
- \`src/policy.ts\` - Negotiation policy configuration
- \`src/settlement.ts\` - Settlement adapter (${config.settlement} mode)
- \`src/kya.ts\` - KYA verification (${config.kya} mode)
${config.template === "express" ? `- \`src/server.ts\` - Express HTTP server` : ""}
${config.template === "worker" ? `- \`src/worker.ts\` - Cloudflare Worker entrypoint` : ""}
${config.template === "nextjs" ? `- \`app/api/pact/route.ts\` - Next.js API route` : ""}

## Customization

1. **Update provider capabilities** in \`src/pactHandler.ts\`
2. **Configure negotiation policy** in \`src/policy.ts\`
3. **Implement settlement logic** in \`src/settlement.ts\`
4. **Add KYA verification** in \`src/kya.ts\`

## Settlement Mode: ${config.settlement}

${config.settlement === "boundary" ? "Boundary mode: Settlement is handled externally or by the SDK. No additional setup required." : ""}
${config.settlement === "stripe" ? "Stripe mode: Install and configure Stripe package. Set PACT_STRIPE_API_KEY environment variable for production." : ""}
${config.settlement === "escrow" ? "Escrow mode: Configure your escrow contract integration. Set ETH_RPC_URL and PRIVATE_KEY environment variables." : ""}

## KYA Mode: ${config.kya}

${config.kya === "none" ? "No KYA verification required. All agents are accepted." : ""}
${config.kya === "basic" ? "Basic KYA: Credential verification without ZK proofs." : ""}
${config.kya === "zk" ? "ZK-KYA: Zero-knowledge proof verification. Install snarkjs package for full support." : ""}

## Documentation

- [Pact SDK Documentation](https://github.com/seankkoons-gif/pact_)
- [Provider Guide](../../docs/PROVIDER_IN_60_MIN.md)
- [Pact Protocol Spec](../../specs/pact/1.0/negotiation-grammar.md)
`;
}

function detectPackageManager(): "npm" | "pnpm" | "yarn" {
  if (process.env.npm_config_user_agent?.includes("yarn")) return "yarn";
  if (process.env.npm_config_user_agent?.includes("pnpm")) return "pnpm";
  return "npm";
}

// CLI entry point
async function main() {
  const args = parse(process.argv.slice(2));
  
  if (args.help || args.h) {
    console.log(`
Usage: create-pact-provider [project-name] [options]

Options:
  --help, -h              Show help
  --template <type>       Template type: express | worker | nextjs
  --settlement <mode>     Settlement mode: boundary | stripe | escrow
  --kya <type>            KYA requirement: none | basic | zk
  --yes                   Skip prompts; use defaults if flags missing
  --no-install            Do not run package manager

Non-interactive mode:
  Non-interactive mode is enabled if --yes is provided OR all three flags
  (--template, --settlement, --kya) are provided.

  In --yes mode, defaults are:
    template=express, settlement=boundary, kya=none

  If --yes is used or all flags are provided, project-name is required.

Examples:
  # Interactive mode
  npx create-pact-provider my-provider
  
  # Non-interactive with flags
  npx create-pact-provider my-provider --template express --settlement boundary --kya none
  
  # Non-interactive with --yes (uses defaults)
  npx create-pact-provider my-provider --yes
  
  # Non-interactive with --yes and --no-install
  npx create-pact-provider my-provider --yes --no-install

This will create a minimal Pact v3 provider project with:
  - HTTP server endpoint (or Next.js route / Cloudflare Worker)
  - Pact protocol handler
  - Negotiation policy
  - Settlement adapter
  - KYA verification
`);
    process.exit(0);
  }
  
  const projectName = args._[0];
  const template = args.template;
  const settlement = args.settlement;
  const kya = args.kya;
  const yes = args.yes || false;
  const noInstall = args["no-install"] || false;
  
  try {
    const config = await collectConfig(projectName, { template, settlement, kya, yes });
    (config as any).noInstall = noInstall;
    await createProject(config);
  } catch (error: any) {
    console.error(\`❌ Error: \${error.message}\`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;