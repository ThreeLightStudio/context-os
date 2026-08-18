import { McpServer } from "@modelcontextprotocol/server";
import { loadConfig, type McpConfig } from "./config.js";
import { ContextApiClient } from "./context-client.js";
import { mcpInstructions, registerContextTools } from "./tools.js";

export function createContextApiClient(config: McpConfig): ContextApiClient {
  return new ContextApiClient({
    serverUrl: config.contextServerUrl,
    apiToken: config.contextServerToken,
    timeoutMs: config.timeoutMs,
  });
}

export function createMcpServer(config: McpConfig = loadConfig(), client = createContextApiClient(config)): McpServer {
  const server = new McpServer({
    name: "context-os-mcp",
    version: "0.1.0",
  }, { instructions: mcpInstructions });
  registerContextTools(server, client, config);
  return server;
}
