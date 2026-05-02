import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import fastGlob from 'fast-glob';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';

const execAsync = promisify(exec);

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveSafe(p: string): string {
  const abs = path.resolve(expandHome(p));
  if (config.root && !abs.startsWith(path.resolve(config.root))) {
    throw new Error(`path outside MCP_ROOT: ${abs}`);
  }
  return abs;
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    'bash',
    {
      title: 'Run a shell command',
      description: 'Execute a bash command on the host. Returns stdout, stderr, exit code.',
      inputSchema: { command: z.string(), cwd: z.string().optional(), timeoutMs: z.number().int().positive().max(600_000).optional() },
    },
    async ({ command, cwd, timeoutMs }) => {
      const opts = { cwd: cwd ? resolveSafe(cwd) : undefined, timeout: timeoutMs ?? 120_000, maxBuffer: 10 * 1024 * 1024 };
      try {
        const { stdout, stderr } = await execAsync(command, opts);
        return { content: [{ type: 'text', text: JSON.stringify({ exitCode: 0, stdout, stderr }) }] };
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        return { content: [{ type: 'text', text: JSON.stringify({ exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' }) }] };
      }
    },
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read a file',
      description: 'Read a UTF-8 file from disk.',
      inputSchema: { path: z.string() },
    },
    async ({ path: p }) => {
      const text = await fs.readFile(resolveSafe(p), 'utf8');
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write a file',
      description: 'Write UTF-8 content to disk. Creates parent directories. Overwrites existing files.',
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path: p, content }) => {
      const abs = resolveSafe(p);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
      return { content: [{ type: 'text', text: `wrote ${content.length} bytes to ${abs}` }] };
    },
  );

  server.registerTool(
    'glob',
    {
      title: 'Glob files',
      description: 'List files matching a glob pattern (fast-glob syntax).',
      inputSchema: { pattern: z.string(), cwd: z.string().optional() },
    },
    async ({ pattern, cwd }) => {
      const matches = await fastGlob(pattern, { cwd: cwd ? resolveSafe(cwd) : undefined, dot: false, onlyFiles: true });
      return { content: [{ type: 'text', text: matches.join('\n') }] };
    },
  );

  server.registerTool(
    'grep',
    {
      title: 'Search file contents',
      description: 'Search for a pattern using ripgrep. Returns matching lines.',
      inputSchema: { pattern: z.string(), path: z.string().optional(), glob: z.string().optional() },
    },
    async ({ pattern, path: searchPath, glob }) => {
      const args = ['rg', '--line-number', '--no-heading', '--color', 'never'];
      if (glob) args.push('--glob', JSON.stringify(glob));
      args.push(JSON.stringify(pattern));
      if (searchPath) args.push(JSON.stringify(resolveSafe(searchPath)));
      try {
        const { stdout } = await execAsync(args.join(' '), { maxBuffer: 10 * 1024 * 1024 });
        return { content: [{ type: 'text', text: stdout }] };
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string };
        // rg exits 1 when there are no matches — that is not an error.
        if (e.code === 1) return { content: [{ type: 'text', text: '' }] };
        throw err;
      }
    },
  );
}
