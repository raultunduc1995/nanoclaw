import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { logger as baseLogger } from "../../core/utils/index.js";

const logger = baseLogger.child({ name: "mcp-client" });

interface McpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

interface McpToolDefinition {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

interface McpConnection {
  client: Client;
  transport: SSEClientTransport;
  tools: McpToolDefinition[];
  /** Maps prefixed tool name → original tool name on the server */
  toolNameMap: Map<string, string>;
  serverName: string;
}

export class McpClientManager {
  private connections: Map<string, McpConnection> = new Map();

  /**
   * Connect to all configured MCP servers and discover their tools.
   * Tool names are prefixed with `serverName__` to avoid collisions.
   */
  async connect(servers: Record<string, McpServerConfig>): Promise<void> {
    const connectPromises = Object.entries(servers).map(([name, config]) => this.connectOne(name, config));
    await Promise.all(connectPromises);
  }

  private async connectOne(serverName: string, config: McpServerConfig): Promise<void> {
    const transport = new SSEClientTransport(new URL(config.url), {
      eventSourceInit: {
        fetch: (input: string | URL | Request, init?: RequestInit) =>
          fetch(input, {
            ...init,
            headers: { ...init?.headers, ...config.headers },
          }),
      },
      requestInit: {
        headers: config.headers,
      },
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

      this.connections.set(serverName, { client, transport, tools, toolNameMap, serverName });
      logger.info({ serverName, toolCount: tools.length, toolNames: tools.map((t) => t.name) }, "MCP server connected");
    } catch (err) {
      logger.error({ serverName, error: err instanceof Error ? err.message : String(err) }, "Failed to connect to MCP server");
      throw err;
    }
  }

  /**
   * Check if a tool name belongs to an MCP server.
   */
  handles(toolName: string): boolean {
    for (const conn of this.connections.values()) {
      if (conn.toolNameMap.has(toolName)) return true;
    }
    return false;
  }

  /**
   * Call an MCP tool. Returns text content. Throws on errors or non-zero exit codes.
   */
  async callTool(prefixedName: string, input: Record<string, unknown>): Promise<string> {
    for (const conn of this.connections.values()) {
      const originalName = conn.toolNameMap.get(prefixedName);
      if (originalName === undefined) continue;

      logger.debug({ serverName: conn.serverName, tool: originalName, input }, "Calling MCP tool");

      const result = await conn.client.callTool({ name: originalName, arguments: input });

      const content = result.content as Array<{ type: string; text?: string }>;
      const textParts = content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
      const text = textParts.join("\n");

      if (result.isError) {
        throw new Error(text || "MCP tool returned an error");
      }

      const structured = result.structuredContent as Record<string, unknown> | undefined;

      if (originalName === "bash" && structured) {
        if (typeof structured.exitCode === "number" && structured.exitCode !== 0) {
          throw new Error(((structured.stdout as string) + (structured.stderr as string)).trim());
        }

        return ((structured.stdout as string) + (structured.stderr as string)).trim();
      }

      if (originalName === "text_editor" && structured) {
        return structured.result as string;
      }

      return text;
    }

    throw new Error(`No MCP server handles tool '${prefixedName}'`);
  }

  /**
   * Disconnect from all MCP servers.
   */
  async close(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.transport.close();
        logger.info({ serverName: name }, "MCP server disconnected");
      } catch (err) {
        logger.warn({ serverName: name, error: err instanceof Error ? err.message : String(err) }, "Error closing MCP connection");
      }
    }
    this.connections.clear();
  }
}
