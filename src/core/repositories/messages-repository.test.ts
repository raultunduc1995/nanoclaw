import { describe, it, expect, beforeEach } from 'vitest';

import { initTestDatabase } from '../db/connection.js';
import type { LocalResource } from '../db/connection.js';
import { createMessagesRepository, MessagesRepository, Message } from './messages-repository.js';

let db: LocalResource;
let repo: MessagesRepository;

beforeEach(() => {
  db = initTestDatabase();
  repo = createMessagesRepository(db.messages);
});

const msg = (overrides?: Partial<Message>): Message => ({
  id: 'msg-1',
  chatJid: 'tg:grp',
  sender: 'tg:user',
  senderName: 'User',
  content: 'hello',
  timestamp: '2024-01-01T00:00:01.000Z',
  isFromMe: false,
  isBotMessage: false,
  ...overrides,
});

describe('saveMessage', () => {
  it('saves and retrieves via getMessagesSince', () => {
    db.chats.storeMetadata('tg:grp', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(msg());

    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('msg-1');
    expect(result[0].chatJid).toBe('tg:grp');
    expect(result[0].senderName).toBe('User');
    expect(result[0].content).toBe('hello');
  });

  it('maps camelCase to snake_case for DB and back', () => {
    db.chats.storeMetadata('tg:grp', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(msg({ isFromMe: true }));

    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(result[0].isFromMe).toBe(true);
    expect(result[0].isBotMessage).toBe(false);
  });

  it('persists reply_to fields through round-trip', () => {
    db.chats.storeMetadata('tg:grp', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(
      msg({
        replyToMessageId: '42',
        replyToMessageContent: 'Are you coming?',
        replyToSenderName: 'Bob',
      }),
    );

    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(result[0].replyToMessageId).toBe('42');
    expect(result[0].replyToMessageContent).toBe('Are you coming?');
    expect(result[0].replyToSenderName).toBe('Bob');
  });

  it('returns undefined for reply fields when not set', () => {
    db.chats.storeMetadata('tg:grp', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(msg());

    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(result[0].replyToMessageId).toBeUndefined();
    expect(result[0].replyToMessageContent).toBeUndefined();
    expect(result[0].replyToSenderName).toBeUndefined();
  });

  it('upserts on duplicate id', () => {
    db.chats.storeMetadata('tg:grp', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(msg({ content: 'original' }));
    repo.saveMessage(msg({ content: 'updated' }));

    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('updated');
  });
});

describe('getMessagesSince', () => {
  beforeEach(() => {
    db.chats.storeMetadata('tg:grp', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(msg({ id: 'm1', content: 'first', timestamp: '2024-01-01T00:00:01.000Z' }));
    repo.saveMessage(msg({ id: 'm2', content: 'second', timestamp: '2024-01-01T00:00:02.000Z' }));
    repo.saveMessage(msg({ id: 'm3', content: 'third', timestamp: '2024-01-01T00:00:03.000Z' }));
  });

  it('returns messages after timestamp', () => {
    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:02.000Z', 'Andy');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('third');
  });

  it('excludes bot messages', () => {
    repo.saveMessage(msg({ id: 'bot', content: 'bot reply', timestamp: '2024-01-01T00:00:04.000Z', isBotMessage: true }));
    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(result.find((m) => m.content === 'bot reply')).toBeUndefined();
  });

  it('caps to limit', () => {
    const result = repo.getMessagesSince('tg:grp', '2024-01-01T00:00:00.000Z', 'Andy', 2);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('second');
    expect(result[1].content).toBe('third');
  });
});

describe('getNewMessages', () => {
  beforeEach(() => {
    db.chats.storeMetadata('tg:g1', { timestamp: '2024-01-01T00:00:00.000Z' });
    db.chats.storeMetadata('tg:g2', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(msg({ id: 'a1', chatJid: 'tg:g1', content: 'g1 first', timestamp: '2024-01-01T00:00:01.000Z' }));
    repo.saveMessage(msg({ id: 'a2', chatJid: 'tg:g2', content: 'g2 first', timestamp: '2024-01-01T00:00:02.000Z' }));
    repo.saveMessage(msg({ id: 'a3', chatJid: 'tg:g1', content: 'g1 second', timestamp: '2024-01-01T00:00:03.000Z' }));
  });

  it('returns messages across groups with updated timestamp', () => {
    const { messages, newTimestamp } = repo.getNewMessages(['tg:g1', 'tg:g2'], '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(3);
    expect(newTimestamp).toBe('2024-01-01T00:00:03.000Z');
  });

  it('returns empty for no groups', () => {
    const { messages, newTimestamp } = repo.getNewMessages([], '', 'Andy');
    expect(messages).toHaveLength(0);
    expect(newTimestamp).toBe('');
  });

  it('returns domain types with camelCase fields', () => {
    const { messages } = repo.getNewMessages(['tg:g1'], '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages[0].chatJid).toBe('tg:g1');
    expect(messages[0].senderName).toBe('User');
    expect(typeof messages[0].isFromMe).toBe('boolean');
  });
});

describe('getLastBotMessageTimestamp', () => {
  it('returns undefined when no bot messages', () => {
    expect(repo.getLastBotMessageTimestamp('tg:grp', 'Andy')).toBeUndefined();
  });

  it('returns last bot timestamp', () => {
    db.chats.storeMetadata('tg:grp', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.saveMessage(msg({ id: 'b1', content: 'bot', timestamp: '2024-01-01T00:00:01.000Z', isBotMessage: true }));
    repo.saveMessage(msg({ id: 'b2', content: 'bot2', timestamp: '2024-01-01T00:00:05.000Z', isBotMessage: true }));

    expect(repo.getLastBotMessageTimestamp('tg:grp', 'Andy')).toBe('2024-01-01T00:00:05.000Z');
  });
});
