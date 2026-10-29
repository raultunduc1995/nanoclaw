import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger as baseLogger } from "../../core/utils/index.js";

const logger = baseLogger.child({ name: "http-mcp-client" });

export interface HttpMcpServerConfig {
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly input_schema: {
    readonly type: "object";
    readonly properties?: Record<string, unknown>;
    readonly required?: string[];
    readonly [key: string]: unknown;
  };
}

interface McpConnection {
  readonly client: Client;
  readonly transport: StreamableHTTPClientTransport;
  readonly toolNameMap: Map<string, string>;
  readonly tools: McpToolDefinition[];
}

export interface HttpMcpClientManager {
  connect(servers: Record<string, HttpMcpServerConfig>): Promise<void>;
  getTools(): McpToolDefinition[];
  hasTool(prefixedName: string): boolean;
  callTool(prefixedName: string, input: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export function createHttpMcpClientManager(): HttpMcpClientManager {
  const connections = new Map<string, McpConnection>();

  const connectOne = async (serverName: string, config: HttpMcpServerConfig): Promise<void> => {
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers,
      },
    });

    const client = new Client({ name: `nanoclaw-${serverName}`, version: "1.0.0" });

    await client.connect(transport);
    const { tools: mcpTools } = await client.listTools();

    const toolNameMap = new Map<string, string>();
    const tools: McpToolDefinition[] = mcpTools.map((tool) => {
      const prefixedName = `${serverName}__${tool.name}`;
      toolNameMap.set(prefixedName, tool.name);
      return {
        name: prefixedName,
        description: tool.description ? `[${serverName}] ${tool.description}` : undefined,
        input_schema: tool.inputSchema as McpToolDefinition["input_schema"],
      };
    });

    connections.set(serverName, {
      client,
      transport,
      tools,
      toolNameMap,
    });
    logger.debug({ serverName, toolCount: tools.length }, "Connected to HTTP MCP server");
  };

  return {
    async connect(servers: Record<string, HttpMcpServerConfig>): Promise<void> {
      const connectPromises = Object.entries(servers).map(([name, config]) => connectOne(name, config));
      await Promise.all(connectPromises);
    },

    getTools(): McpToolDefinition[] {
      const allTools: McpToolDefinition[] = [];
      for (const conn of connections.values()) {
        allTools.push(...conn.tools);
      }
      return allTools;
    },

    hasTool(prefixedName: string): boolean {
      for (const conn of connections.values()) {
        if (conn.toolNameMap.has(prefixedName)) {
          return true;
        }
      }
      return false;
    },

    async callTool(prefixedName: string, input: Record<string, unknown>): Promise<string> {
      for (const conn of connections.values()) {
        const originalName = conn.toolNameMap.get(prefixedName);
        if (!originalName) {
          continue;
        }

        const result = await conn.client.callTool({ name: originalName, arguments: input });
        const content = result.content as Array<{ type: string; text?: string }>;
        const textParts = content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
        const text = textParts.join("\n");

        if (result.isError) {
          throw new Error(text || `MCP tool '${prefixedName}' returned an error`);
        }

        return text;
      }

      throw new Error(`No HTTP MCP server handles tool '${prefixedName}'`);
    },

    async close(): Promise<void> {
      for (const [name, conn] of connections) {
        try {
          await conn.transport.close();
          logger.debug({ serverName: name }, "HTTP MCP server disconnected");
        } catch (err) {
          logger.warn({ serverName: name, error: err instanceof Error ? err.message : String(err) }, "Error closing HTTP MCP connection");
        }
      }
      connections.clear();
    },
  };
}
