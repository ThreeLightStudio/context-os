import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createBrainApp } from "./app.js";
import { loadConfig, type BrainConfig } from "./config.js";
import { ServerContextClient } from "./context/server-context-client.js";
import { LocalOpenAICompatibleProvider } from "./providers/local-openai-compatible.js";
import type { ModelProvider } from "./providers/model-provider.js";
import { startNodeServer } from "./server.js";

export interface RuntimeOptions {
  config?: BrainConfig;
  provider?: ModelProvider;
}

export function createRuntime(options: RuntimeOptions = {}) {
  const config = options.config ?? loadConfig();
  if (config.provider !== "local") throw new Error(`unsupported BRAIN_PROVIDER: ${config.provider}`);
  const provider = options.provider ?? new LocalOpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.providerApiKey,
    timeoutMs: config.providerTimeoutMs,
  });
  const contextSource = config.contextServerUrl && config.contextServerToken
    ? new ServerContextClient({ serverUrl: config.contextServerUrl, apiToken: config.contextServerToken })
    : undefined;
  const app = createBrainApp({ config, provider, contextSource });
  return { config, provider, contextSource, app };
}

async function main(): Promise<void> {
  const runtime = createRuntime();
  const server = await startNodeServer(runtime.app, runtime.config);
  console.log(`server-brain listening on http://${runtime.config.host}:${runtime.config.port}`);
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}

export { createBrainApp } from "./app.js";
export { loadConfig } from "./config.js";
export { ActionRegistry, createDefaultActionRegistry } from "./actions/index.js";
export { dailySummaryAction } from "./actions/index.js";
export type { DailySummaryContext, DailySummaryInput } from "./context/daily-summary-context.js";
export type { DailySummaryOutput } from "./actions/daily-summary.js";
export { TaskRunner, InMemoryTaskStore } from "./tasks/task-runner.js";
export { LocalOpenAICompatibleProvider } from "./providers/local-openai-compatible.js";
export type { ModelProvider } from "./providers/model-provider.js";
