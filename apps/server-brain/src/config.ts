export const DEFAULT_BRAIN_HOST = "127.0.0.1";
export const DEFAULT_BRAIN_PORT = 17002;
export const DEFAULT_BRAIN_BASE_URL = "http://127.0.0.1:11434/v1";
export const DEFAULT_BRAIN_MODEL = "local-model";

export interface BrainConfig {
  host: string;
  port: number;
  provider: string;
  baseUrl: string;
  model: string;
  apiToken?: string;
  allowedOrigins: Set<string>;
  contextServerUrl?: string;
  contextServerToken?: string;
  providerApiKey?: string;
  providerTimeoutMs: number;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${name} must be a valid TCP port`);
  return parsed;
}

function origins(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrainConfig {
  const baseUrl = (env.BRAIN_BASE_URL ?? DEFAULT_BRAIN_BASE_URL).trim();
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("BRAIN_BASE_URL must be a valid http(s) URL");
  }

  const contextServerUrl = env.CONTEXT_SERVER_URL?.trim() || undefined;
  if (contextServerUrl) {
    try {
      const url = new URL(contextServerUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      throw new Error("CONTEXT_SERVER_URL must be a valid http(s) URL");
    }
  }

  return {
    host: env.BRAIN_HOST?.trim() || DEFAULT_BRAIN_HOST,
    port: positiveInteger(env.BRAIN_PORT, DEFAULT_BRAIN_PORT, "BRAIN_PORT"),
    provider: env.BRAIN_PROVIDER?.trim() || "local",
    baseUrl,
    model: env.BRAIN_MODEL?.trim() || DEFAULT_BRAIN_MODEL,
    apiToken: env.BRAIN_API_TOKEN?.trim() || undefined,
    allowedOrigins: origins(env.BRAIN_ALLOWED_ORIGINS),
    contextServerUrl,
    contextServerToken: env.CONTEXT_SERVER_TOKEN?.trim() || undefined,
    providerApiKey: env.BRAIN_PROVIDER_API_KEY?.trim() || undefined,
    providerTimeoutMs: positiveInteger(env.BRAIN_PROVIDER_TIMEOUT_MS, 30_000, "BRAIN_PROVIDER_TIMEOUT_MS"),
  };
}
