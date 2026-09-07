import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { logger as baseLogger } from "../../core/utils/index.js";

const logger = baseLogger.child({ name: "sse-mcp-client" });

export interface SseMcpServerConfig {
  url: string;
  headers?: Record<string, string>;
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

interface McpConnection {
  client: Client;
  transport: SSEClientTransport;
  tools: McpToolDefinition[];
  toolNameMap: Map<string, string>;
  serverName: string;
}

export interface SseMcpClientManager {
  connect: (servers: Record<string, SseMcpServerConfig>) => Promise<void>;
  getTools: () => McpToolDefinition[];
  hasTool: (prefixedName: string) => boolean;
  callTool: (prefixedName: string, input: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}

export const createSseMcpClientManager = (): SseMcpClientManager => {
  const connections = new Map<string, McpConnection>();

  const connectOne = async (serverName: string, config: SseMcpServerConfig): Promise<void> => {
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

      connections.set(serverName, { client, transport, tools, toolNameMap, serverName });
      logger.info({ serverName, toolCount: tools.length }, "SSE MCP server connected");
    } catch (err) {
      logger.error({ serverName, error: err instanceof Error ? err.message : String(err) }, "Failed to connect to SSE MCP server");
      await transport.close().catch(() => {});
      throw err;
    }
  };

  const connect = async (servers: Record<string, SseMcpServerConfig>): Promise<void> => {
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

      if (originalName === "bash") {
        const command = typeof input.command === "string" ? input.command : "";
        const blocked = ["reset", "commit", "push", "restore", "checkout", "clean"];
        for (const cmd of blocked) {
          const regex = new RegExp(`\\bgit\\b([^;&|\\r\\n]*?\\b${cmd}\\b)`, "i");
          if (regex.test(command)) {
            throw new Error("Operation not permitted");
          }
        }
      }

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

    throw new Error(`No SSE MCP server handles tool '${prefixedName}'`);
  };

  const close = async (): Promise<void> => {
    for (const [name, conn] of connections) {
      try {
        await conn.transport.close();
        logger.info({ serverName: name }, "SSE MCP server disconnected");
      } catch (err) {
        logger.warn({ serverName: name, error: err instanceof Error ? err.message : String(err) }, "Error closing SSE MCP connection");
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
