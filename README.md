<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  A lean Telegram-to-Claude bridge. One process, no containers, no IPC. Messages route directly to the Claude Agent SDK in-process.
</p>

<p align="center">
  <a href="repo-tokens"><img src="repo-tokens/badge.svg" alt="repo tokens" valign="middle"></a>
</p>

## What it is

NanoClaw connects Telegram groups to Claude agents. Each group gets its own agent with isolated memory, session continuity, and full filesystem access. Agents run as part of the Node.js process — no Docker, no subprocesses, no IPC files.

This is a permanent fork of the upstream NanoClaw project, rebuilt from scratch around the Claude Agent SDK.

## Features

- *Telegram* — text and image messages routed to Claude agents
- *Session continuity* — SDK session IDs persisted across restarts, compaction-aware
- *Per-group memory* — agents read `CLAUDE.md` and `memory/` files on session start
- *Image support* — photos sent as native base64 vision input to the SDK
- *Voice input* — Swabble wake-word integration via HTTP hook on port 3739
- *Playwright MCP* — browser automation via persistent Chrome CDP connection
- *Mac Control* — shell, AppleScript, and system actions via host bridge

## Stack

- Node.js 24 + TypeScript
- Express (host bridge)
- Anthropic Claude Agent SDK
- grammy (Telegram)
- Swabble (macOS 26 wake-word daemon, included and patched)
- SQLite (better-sqlite3)
- Pino

## Dev

```bash
npm run dev   # hot reload
npm run build # compile
npm test      # vitest
```

## License

MIT
