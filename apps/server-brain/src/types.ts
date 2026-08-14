import type { ContextSource } from "./context/server-context-client.js";
import type { ModelProvider } from "./providers/model-provider.js";

export type JsonObject = Record<string, unknown>;

export type BrainTaskStatus = "pending" | "running" | "completed" | "failed";

export interface BrainTaskError {
  message: string;
  code: string;
}

export interface BrainTask {
  id: string;
  action: string;
  status: BrainTaskStatus;
  input: unknown;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: BrainTaskError;
}

export interface ActionMetadata {
  name: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
}

export interface ActionExecutionRequest {
  action: string;
  input?: unknown;
  context?: unknown;
}

export interface ActionExecutionResponse {
  task: BrainTask;
  result: unknown;
}

export interface ActionExecutionDependencies {
  provider: ModelProvider;
  contextSource?: ContextSource;
}
