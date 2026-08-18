export type McpMode = "read" | "read-write";
export type McpTransport = "stdio" | "streamable-http";

export type McpConfig = {
  contextServerUrl: string;
  contextServerToken: string;
  mode: McpMode;
  transport: McpTransport;
  httpHost: string;
  httpPort: number;
  httpPath: string;
  httpToken: string;
  timeoutMs: number;
};

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const mode = env.CONTEXT_MCP_MODE?.trim() || "read";
  if (mode !== "read" && mode !== "read-write") {
    throw new Error("CONTEXT_MCP_MODE must be read or read-write");
  }

  const transport = env.CONTEXT_MCP_TRANSPORT?.trim() || "stdio";
  if (transport !== "stdio" && transport !== "streamable-http") {
    throw new Error("CONTEXT_MCP_TRANSPORT must be stdio or streamable-http");
  }

  const httpToken = env.CONTEXT_MCP_HTTP_TOKEN?.trim() ?? "";
  if (transport === "streamable-http" && !httpToken) {
    throw new Error("CONTEXT_MCP_HTTP_TOKEN is required for streamable-http transport");
  }

  const httpPath = env.CONTEXT_MCP_HTTP_PATH?.trim() || "/mcp";
  if (!httpPath.startsWith("/")) throw new Error("CONTEXT_MCP_HTTP_PATH must start with /");

  return {
    contextServerUrl: env.CONTEXT_SERVER_URL?.trim() ?? "",
    contextServerToken: env.CONTEXT_SERVER_TOKEN?.trim() ?? "",
    mode,
    transport,
    httpHost: env.CONTEXT_MCP_HTTP_HOST?.trim() || "127.0.0.1",
    httpPort: positiveInteger(env.CONTEXT_MCP_HTTP_PORT, 8_789, "CONTEXT_MCP_HTTP_PORT"),
    httpPath,
    httpToken,
    timeoutMs: positiveInteger(env.CONTEXT_MCP_TIMEOUT_MS, 10_000, "CONTEXT_MCP_TIMEOUT_MS"),
  };
}
