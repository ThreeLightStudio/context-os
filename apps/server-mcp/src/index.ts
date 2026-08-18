import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig, type McpConfig } from "./config.js";
import { createMcpServer } from "./mcp-server.js";
import { listenStreamableHttpNodeServer } from "./http.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  if (config.transport === "streamable-http") {
    await listenStreamableHttpNodeServer(config);
    console.error(`Context OS MCP server listening on http://${config.httpHost}:${config.httpPort}${config.httpPath}`);
    return;
  }

  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Context OS MCP server listening on stdio");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}

export { ContextApiClient, ContextApiError } from "./context-client.js";
export { loadConfig } from "./config.js";
export type { McpConfig, McpMode, McpTransport } from "./config.js";
export { buildWorkState, parseContextEvent, resolveWork, workNameMatches } from "./events.js";
export { createMcpServer } from "./mcp-server.js";
export { createStreamableHttpNodeServer, StreamableHttpMcpApp } from "./http.js";
export { normalizeRecord } from "./normalize.js";
export { parseSince, recordForAppend } from "./tools.js";
export type * from "./types.js";
