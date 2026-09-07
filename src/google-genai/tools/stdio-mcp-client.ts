import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logger as baseLogger } from "../../core/utils/index.js";

const logger = baseLogger.child({ name: "stdio-mcp-client" });

export interface StdioMcpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

interface StdioMcpConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolDefinition[];
  toolNameMap: Map<string, string>;
  serverName: string;
}

export interface StdioMcpClientManager {
  connect: (servers: Record<string, StdioMcpServerConfig>) => Promise<void>;
  getTools: () => McpToolDefinition[];
  hasTool: (prefixedName: string) => boolean;
  callTool: (prefixedName: string, input: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}

export const createStdioMcpClientManager = (): StdioMcpClientManager => {
  const connections = new Map<string, StdioMcpConnection>();

  const connectOne = async (serverName: string, config: StdioMcpServerConfig): Promise<void> => {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      stderr: "pipe",
    });

    const client = new Client({ name: `nanoclaw-${serverName}`, version: "1.0.0" });

    try {
      await client.connect(transport);
      const { tools: mcpTools } = await client.listTools();

      const toolNameMap = new Map<string, string>();
      const tools: McpToolDefinition[] = mcpTools.map((tool) => {
        const prefixedName = `${serverName}__${tool.name}`;
        toolNameMap.set(prefixedName, tool.name);
        return {
          name: prefixedName,
          description: `[${serverName}] ${tool.description ?? ""}`,
          input_schema: tool.inputSchema as McpToolDefinition["input_schema"],
        };
      });

      connections.set(serverName, { client, transport, tools, toolNameMap, serverName });
      logger.info({ serverName, toolCount: tools.length }, "Stdio MCP server connected");
    } catch (err) {
      logger.error({ serverName, error: err instanceof Error ? err.message : String(err) }, "Failed to connect to Stdio MCP server");
      await transport.close().catch(() => {});
      throw err;
    }
  };

  const connect = async (servers: Record<string, StdioMcpServerConfig>): Promise<void> => {
    const connectPromises = Object.entries(servers).map(([name, config]) => connectOne(name, config));
    await Promise.all(connectPromises);
  };

  const getTools = (): McpToolDefinition[] => {
    const allTools: McpToolDefinition[] = [];
    for (const conn of connections.values()) {
      allTools.push(...conn.tools);
    }
    return allTools;
  };

  const hasTool = (prefixedName: string): boolean => {
    for (const conn of connections.values()) {
      if (conn.toolNameMap.has(prefixedName)) {
        return true;
      }
    }
    return false;
  };

  const callTool = async (prefixedName: string, input: Record<string, unknown>): Promise<string> => {
    for (const conn of connections.values()) {
      const originalName = conn.toolNameMap.get(prefixedName);
      if (originalName === undefined) {
        continue;
      }

      const result = await conn.client.callTool({ name: originalName, arguments: input });
      const content = result.content as Array<{ type: string; text?: string }>;
      const textParts = content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
      const text = textParts.join("\n");

      if (result.isError) {
        throw new Error(text || "MCP tool returned an error");
      }

      return text;
    }

    throw new Error(`No Stdio MCP server handles tool '${prefixedName}'`);
  };

  const close = async (): Promise<void> => {
    for (const [name, conn] of connections) {
      try {
        await conn.transport.close();
        logger.info({ serverName: name }, "Stdio MCP server disconnected");
      } catch (err) {
        logger.warn({ serverName: name, error: err instanceof Error ? err.message : String(err) }, "Error closing Stdio MCP connection");
      }
    }
    connections.clear();
  };

  return {
    connect,
    getTools,
    hasTool,
    callTool,
    close,
  };
};
