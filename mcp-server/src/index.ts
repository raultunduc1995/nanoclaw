import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { requireAuth } from './auth.js';
import { registerTools } from './tools.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const transports = new Map<string, SSEServerTransport>();

app.get('/sse', requireAuth, async (req, res) => {
  const token = ((req.header('x-auth') || req.query.token) as string) ?? '';
  const endpoint = token ? `/messages?token=${encodeURIComponent(token)}` : '/messages';
  const transport = new SSEServerTransport(endpoint, res);

  const server = new McpServer({ name: 'mcp-server', version: '0.1.0' });
  registerTools(server);

  transports.set(transport.sessionId, transport);
  res.on('close', async () => {
    transports.delete(transport.sessionId);
    await server.close().catch(() => {});
  });

  await server.connect(transport);
  logger.info({ sessionId: transport.sessionId }, 'SSE client connected');
});

app.post('/messages', requireAuth, async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: 'no transport for sessionId' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', sessions: transports.size });
});

app.listen(config.port, config.host, () => {
  logger.info(`MCP server listening on http://${config.host}:${config.port}`);
});
