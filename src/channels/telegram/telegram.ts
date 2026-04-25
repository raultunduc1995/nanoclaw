import https from 'https';

import { Api, Bot, BotError } from 'grammy';

import { TELEGRAM_BOT_TOKEN } from '../../core/utils/config.js';
import { logger } from '../../core/utils/logger.js';
import type { Channel, ChannelOpts } from '../types.js';

export interface TelegramChannelOpts extends ChannelOpts {
  type: 'telegram';
}

export class TelegramChannel implements Channel {
  name = 'telegram';

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
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName = chatType === 'private' ? ctx.from?.first_name || 'Private' : 'title' in ctx.chat ? ctx.chat.title || 'Unknown' : 'Unknown';
      ctx.reply(`Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`, { parse_mode: 'Markdown' });
    });

    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) {
        const cmd = ctx.message.text.slice(1).split(/[\s@]/)[0].toLowerCase();
        if ('chatid' === cmd) return;
      }

      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.getRegisteredGroups()[chatJid];
      if (!group) {
        logger.debug({ chatJid }, 'Message from unregistered Telegram chat');
        return;
      }

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName = ctx.from?.first_name || ctx.from?.username || ctx.from?.id.toString() || 'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();
      const chatName = ctx.chat.type === 'private' ? senderName || 'Private' : 'title' in ctx.chat ? ctx.chat.title || chatJid : chatJid;

      const replyTo = ctx.message.reply_to_message;
      const replyToMessageId = replyTo?.message_id?.toString();
      const replyToMessageContent = replyTo?.text || replyTo?.caption;
      const replyToSenderName = replyTo ? replyTo.from?.first_name || replyTo.from?.username || replyTo.from?.id?.toString() || 'Unknown' : undefined;

      this.opts.onInboundMessage({ kind: 'text', id: msgId, chatJid, sender, senderName, content: ctx.message.text, timestamp, replyToMessageId, replyToMessageContent, replyToSenderName }, group);
      logger.info({ chatJid, chatName, sender: senderName }, 'Telegram message received');
    });

    this.bot.on('message:photo', async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.getRegisteredGroups()[chatJid];
      if (!group) {
        logger.debug({ chatJid }, 'Message from unregistered Telegram chat');
        return;
      }

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName = ctx.from?.first_name || ctx.from?.username || ctx.from?.id.toString() || 'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();
      const content = ctx.message.caption || '';

      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const imageBase64 = await downloadTelegramFileAsBase64(ctx.api, largest.file_id);

      this.opts.onInboundMessage({ kind: 'image', id: msgId, chatJid, sender, senderName, content, timestamp, imageBase64, imageMimeType: 'image/jpeg' }, group);
      logger.info({ chatJid, sender: senderName }, 'Telegram photo received');
    });

    // Handle errors gracefully
    this.bot.catch((err: BotError) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Start polling — returns a Promise that resolves when started
    return new Promise<void>((resolve) => {
      this.bot.start({
        onStart: (botInfo) => {
          logger.info({ username: botInfo.username, id: botInfo.id }, 'Telegram bot connected');
          resolve();
        },
      });
    });
  }

  async sendMessage(jid: string, text: string, threadId?: string): Promise<void> {
    try {
      const numericId = jid.replace(/^tg:/, '');
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
      logger.debug({ jid, length: text.length, threadId }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    this.bot.stop();
    logger.info('Telegram bot stopped');
  }

  async setTyping(jid: string): Promise<void> {
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
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
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        })
        .on('error', reject);
    });

    return buffer.toString('base64');
  } catch (err) {
    logger.error({ fileId, err }, 'Failed to download Telegram file');
    return undefined;
  }
}

/**
 * Send a message with Telegram Markdown parse mode, falling back to plain text.
 * Claude's output naturally matches Telegram's Markdown v1 format:
 *   *bold*, _italic_, `code`, ```code blocks```, [links](url)
 */
async function sendTelegramMessage(api: { sendMessage: Api['sendMessage'] }, chatId: string | number, text: string, options: { message_thread_id?: number } = {}): Promise<void> {
  try {
    await api.sendMessage(chatId, text, { ...options, parse_mode: 'Markdown' });
  } catch (err) {
    logger.debug({ err }, 'Markdown send failed, falling back to plain text');
    await api.sendMessage(chatId, text, options);
  }
}
