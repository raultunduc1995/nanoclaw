import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3737),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  authSecret: required('MCP_AUTH_SECRET'),
  root: process.env.MCP_ROOT ?? '',
} as const;
