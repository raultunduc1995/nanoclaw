import path from "path";

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

const PROJECT_ROOT = process.cwd();
export const STORE_DIR = path.resolve(PROJECT_ROOT, "store");
export const HISTORY_DIR = path.join(STORE_DIR, "history");
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, "groups");

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
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export const TIMEZONE = resolveTimezone();
