import crypto from 'crypto';
import type { RequestHandler } from 'express';
import { config } from './config.js';
import { logger } from './logger.js';

// Static bearer token over LAN. Client sends:
//   X-Auth: <shared-secret>
// Server constant-time compares against MCP_AUTH_SECRET. Works with static
// .mcp.json headers (no per-request signing needed).
const expected = Buffer.from(config.authSecret);

export const requireAuth: RequestHandler = (req, res, next) => {
  const provided = req.header('x-auth');
  if (!provided) {
    res.status(401).json({ error: 'missing X-Auth' });
    return;
  }
  const a = Buffer.from(provided);
  if (a.length !== expected.length || !crypto.timingSafeEqual(a, expected)) {
    logger.warn({ ip: req.ip }, 'rejected request: bad token');
    res.status(401).json({ error: 'bad token' });
    return;
  }
  next();
};
