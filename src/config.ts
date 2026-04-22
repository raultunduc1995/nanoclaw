import path from 'path';
import fs from 'fs';

import { logger } from './logger.js';

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
function readEnvFile(keys: string[], fileName: string = '.env'): Record<string, string> {
  const readFile = (filePath: string): string | null => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  };

  const parseEnvContent = (content: string, keys: string[]): Record<string, string> => {
    const result: Record<string, string> = {};
    const wanted = new Set(keys);

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!wanted.has(key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) result[key] = value;
    }

    return result;
  };

  const envFile = path.join(process.cwd(), fileName);
  const content = readFile(envFile);
  if (content === null) {
    logger.debug('environment file not found');
    return {};
  }

  return parseEnvContent(content, keys);
}

// Timezone for scheduled tasks, message formatting, etc.
function resolveConfigTimezone(): string {
  // Utility function to validate timezone strings. This is used to ensure that the TZ environment variable is set to a valid timezone, which is important for correct time handling in scheduled tasks and message formatting.
  const isValidTimezone = (tz: string): boolean => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };

  const candidates = [process.env.TZ, envConfig.TZ, Intl.DateTimeFormat().resolvedOptions().timeZone];
  for (const tz of candidates) {
    if (tz && isValidTimezone(tz)) return tz;
  }

  return 'UTC';
}

// Read config values from .env (falls back to process.env).
const envConfig = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ASSISTANT_NAME', 'ENABLE_MAC_CONTROL', 'BRIDGE_SECRET', 'ENABLE_TELEGRAM', 'TELEGRAM_BOT_TOKEN', 'MAX_MESSAGES_PER_PROMPT']);

export const CLAUDE_CODE_OAUTH_TOKEN = envConfig.CLAUDE_CODE_OAUTH_TOKEN || '';
export const ASSISTANT_NAME = envConfig.ASSISTANT_NAME || 'Bee';
export const ENABLE_MAC_CONTROL = envConfig.ENABLE_MAC_CONTROL === 'true';
export const BRIDGE_SECRET = envConfig.BRIDGE_SECRET || 'default-bridge-secret';
export const ENABLE_TELEGRAM = envConfig.ENABLE_TELEGRAM === 'true';
export const TELEGRAM_BOT_TOKEN = envConfig.TELEGRAM_BOT_TOKEN || '';
export const MAX_MESSAGES_PER_PROMPT = parseInt(envConfig.MAX_MESSAGES_PER_PROMPT || '10', 10);
export const SCHEDULER_POLL_INTERVAL = 60000;

const PROJECT_ROOT = process.cwd();
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const IPC_POLL_INTERVAL = 1000;
export const TIMEZONE = resolveConfigTimezone();
