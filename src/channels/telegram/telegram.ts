import https from "https";

import { Api, Bot, BotError } from "grammy";

import { TELEGRAM_BOT_TOKEN, TIMEZONE } from "../../core/utils/config.js";
import { logger } from "../../core/utils/logger.js";
import type { Channel, ChannelOpts } from "../types.js";
import { markdownToTelegramHTML } from "./telegram-html-converter.js";

export interface TelegramChannelOpts extends ChannelOpts {
  type: "telegram";
}

export class TelegramChannel implements Channel {
  name = "telegram";

  private bot!: Bot;
  private opts: TelegramChannelOpts;

  constructor(opts: TelegramChannelOpts) {
    this.opts = opts;
    this.bot = new Bot(TELEGRAM_BOT_TOKEN, {
      client: {
        baseFetchConfig: { agent: https.globalAgent, compress: true },
      },
    });
  }

  async connect(): Promise<void> {
    // Command to get chat ID (useful for registration)
    this.bot.command("chatid", (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName = chatType === "private" ? ctx.from?.first_name || "Private" : "title" in ctx.chat ? ctx.chat.title || "Unknown" : "Unknown";
      ctx.reply(`Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`, { parse_mode: "Markdown" });
      // logger.info(`Register new bot: ${chatId}`);
      // this.opts.registerNewGroup(`tg:${chatId}`, { name: `${chatName}`, folder: `telegram-${chatName}`, addedAt: new Date().toISOString(), sessionId: '' });
    });

    this.bot.on("message:text", async (ctx) => {
      if (ctx.message.text.startsWith("/")) return;

      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.getRegisteredGroups()[chatJid];
      if (!group) {
        logger.debug({ chatJid }, "Message from unregistered Telegram chat");
        return;
      }

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName = ctx.from?.first_name || ctx.from?.username || ctx.from?.id.toString() || "Unknown";
      const msgId = ctx.message.message_id.toString();

      const replyTo = ctx.message.reply_to_message;
      const replyToMessageId = replyTo?.message_id?.toString();
      const replyToMessageContent = replyTo?.text || replyTo?.caption;
      const replyToSenderName = replyTo ? replyTo.from?.first_name || replyTo.from?.username || replyTo.from?.id?.toString() || "Unknown" : undefined;

      const prompt = getPrompt({ timestamp, senderName, content: ctx.message.text, replyToMessageId, replyToMessageContent, replyToSenderName });

      logger.debug({ chatJid }, "Telegram message received");
      this.opts.onInboundMessage({ kind: "text", id: msgId, chatJid, prompt }, group);
    });

    this.bot.on("message:photo", async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.getRegisteredGroups()[chatJid];
      if (!group) {
        logger.debug({ chatJid }, "Message from unregistered Telegram chat");
        return;
      }

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName = ctx.from?.first_name || ctx.from?.username || ctx.from?.id.toString() || "Unknown";
      const msgId = ctx.message.message_id.toString();
      const content = ctx.message.caption || "";

      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const imageBase64 = await downloadTelegramFileAsBase64(ctx.api, largest.file_id);

      const replyTo = ctx.message.reply_to_message;
      const replyToMessageId = replyTo?.message_id?.toString();
      const replyToMessageContent = replyTo?.text || replyTo?.caption;
      const replyToSenderName = replyTo ? replyTo.from?.first_name || replyTo.from?.username || replyTo.from?.id?.toString() || "Unknown" : undefined;

      const prompt = getPrompt({ timestamp, senderName, content, replyToMessageId, replyToMessageContent, replyToSenderName });

      logger.debug({ chatJid }, "Telegram photo received");
      this.opts.onInboundMessage({ kind: "image", imageBase64, imageMimeType: "image/jpeg", id: msgId, chatJid, prompt }, group);
    });

    // Handle errors gracefully
    this.bot.catch((err: BotError) => {
      logger.error({ err: err.message }, "Telegram bot error");
    });

    // Start polling — returns a Promise that resolves when started
    return new Promise<void>((resolve) => {
      this.bot.start({
        onStart: (botInfo) => {
          logger.debug({ username: botInfo.username, id: botInfo.id }, "Telegram bot connected");
          resolve();
        },
      });
    });
  }

  async sendMessage(jid: string, text: string, threadId?: string): Promise<void> {
    logger.debug({ jid, text, threadId }, "Sending telegram message");

    try {
      const numericId = jid.replace(/^tg:/, "");
      const options = threadId ? { message_thread_id: parseInt(threadId, 10) } : {};

      // Telegram has a 4096 character limit per message — split if needed
      const MAX_LENGTH = 4096;
      if (text.length <= MAX_LENGTH) {
        await sendTelegramMessage(this.bot.api, numericId, text, options);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await sendTelegramMessage(this.bot.api, numericId, text.slice(i, i + MAX_LENGTH), options);
        }
      }
    } catch (err) {
      logger.error({ jid, err }, "Failed to send Telegram message");
    }
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith("tg:");
  }

  async disconnect(): Promise<void> {
    this.bot.stop();
    logger.info("Telegram bot stopped");
  }

  async setTyping(jid: string): Promise<void> {
    try {
      const numericId = jid.replace(/^tg:/, "");
      await this.bot.api.sendChatAction(numericId, "typing");
    } catch (err) {
      logger.debug({ jid, err }, "Failed to send Telegram typing indicator");
    }
  }
}

// --- Helpers ---

async function downloadTelegramFileAsBase64(api: Api, fileId: string): Promise<string | undefined> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) return undefined;

    const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      https
        .get(url, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        })
        .on("error", reject);
    });

    return buffer.toString("base64");
  } catch (err) {
    logger.error({ fileId, err }, "Failed to download Telegram file");
    return undefined;
  }
}

async function sendTelegramMessage(api: { sendMessage: Api["sendMessage"] }, chatId: string | number, text: string, options: { message_thread_id?: number } = {}): Promise<void> {
  const formatted = markdownToTelegramHTML(text);
  try {
    await api.sendMessage(chatId, formatted, { ...options, parse_mode: "HTML" });
  } catch (err) {
    logger.error({ err }, "HTML send failed, falling back to plain text");
    await api.sendMessage(chatId, text, options);
  }
}

const getPrompt = (
  message: { timestamp: string; senderName: string; content: string; replyToMessageId?: string; replyToMessageContent?: string; replyToSenderName?: string },
  timezone: string = TIMEZONE,
): string => {
  const displayTime = formatLocalTime(message.timestamp, timezone);

  const senderAttr = `sender="${escapeXml(message.senderName)}"`;
  const timezoneAttr = `timezone="${escapeXml(timezone)}"`;
  const timeAttr = `time="${escapeXml(displayTime)}"`;
  const replyAttr = message.replyToMessageId ? ` reply_to="${escapeXml(message.replyToMessageId)}"` : "";
  const content = `<content>${escapeXml(message.content)}</content>`;

  if (message.replyToMessageContent && message.replyToSenderName) {
    const replySnippet = `<quoted_message from="${escapeXml(message.replyToSenderName)}">${escapeXml(message.replyToMessageContent)}</quoted_message>`;
    return `<message ${senderAttr} ${timezoneAttr} ${timeAttr}${replyAttr}>${replySnippet}${content}</message>`;
  } else {
    return `<message ${senderAttr} ${timezoneAttr} ${timeAttr}${replyAttr}>${content}</message>`;
  }
};

const formatLocalTime = (utcIso: string, timezone: string): string => {
  const isValidTimezone = (tz: string): boolean => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };

  const date = new Date(utcIso);
  return date.toLocaleString("en-US", {
    timeZone: isValidTimezone(timezone) ? timezone : "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const escapeXml = (s: string): string => {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};
