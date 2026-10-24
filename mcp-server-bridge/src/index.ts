import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";

interface BridgeConfig {
  remoteUrl: string;
  authSecret: string;
}

const config: BridgeConfig = {
  remoteUrl: process.env.REMOTE_MCP_URL ?? "http://192.168.1.132:3737/sse",
  authSecret: process.env.MCP_AUTH_SECRET ?? "",
};

export const createMcpBridge = async () => {
  const remoteTransport = new SSEClientTransport(new URL(config.remoteUrl), {
    eventSourceInit: {
      headers: {
        "X-Auth": config.authSecret,
      },
    },
    requestInit: {
      headers: {
        "X-Auth": config.authSecret,
      },
    },
  });

  const remoteClient = new Client({ name: "mcp-server-bridge-client", version: "0.1.0" }, { capabilities: {} });

  await remoteClient.connect(remoteTransport);

  const localServer = new Server(
    { name: "work-mac-bridge", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  localServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return await remoteClient.listTools();
  });

  localServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await remoteClient.callTool(request.params);
    const content = result.content ? [...result.content] : [];
    if (content.length === 0 && "structuredContent" in result && result.structuredContent) {
      const sc = result.structuredContent as {
        stdout?: string;
        stderr?: string;
        content?: string;
        totalLines?: number;
        status?: string;
        path?: string;
        bytesWritten?: number;
        exitCode?: number;
      };
      const parts: string[] = [];
      if (sc.stdout) parts.push(sc.stdout.trimEnd());
      if (typeof sc.content === "string" && sc.content.length > 0) parts.push(sc.content);
      if (sc.status === "ok") {
        const bytesInfo = typeof sc.bytesWritten === "number" ? ` (${sc.bytesWritten} bytes)` : "";
        parts.push(`OK: ${sc.path ?? ""}${bytesInfo}`.trim());
      }
      if (sc.stderr) parts.push(`[stderr]\n${sc.stderr.trimEnd()}`);
      if (typeof sc.exitCode === "number" && sc.exitCode !== 0) parts.push(`[exit code: ${sc.exitCode}]`);
      content.push({ type: "text", text: parts.join("\n") || "(empty output)" });
    }
    return {
      ...result,
      content,
    };
  });

  localServer.setRequestHandler(ListResourcesRequestSchema, async () => {
    return await remoteClient.listResources();
  });

  localServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return await remoteClient.readResource(request.params);
  });

  localServer.setRequestHandler(ListPromptsRequestSchema, async () => {
    return await remoteClient.listPrompts();
  });

  const stdioTransport = new StdioServerTransport();
  await localServer.connect(stdioTransport);
};

createMcpBridge().catch((err) => {
  process.stderr.write(`[bridge-error] ${String(err)}\n`);
  process.exit(1);
});
