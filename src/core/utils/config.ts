import path from 'path';

export const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
export const ENABLE_MAC_CONTROL = process.env.ENABLE_MAC_CONTROL === 'true';
export const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'default-bridge-secret';
export const ENABLE_TELEGRAM = process.env.ENABLE_TELEGRAM === 'true';
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const PROJECT_ROOT = process.cwd();
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');

function resolveTimezone(): string {
  const tz = process.env.TZ;
  if (tz) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return tz;
    } catch {
      // fall through
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export const TIMEZONE = resolveTimezone();
