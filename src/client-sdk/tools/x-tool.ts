import { Client, OAuth1 } from "@xdevplatform/xdk";
import { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } from "../../core/utils/config.js";
import { logger } from "../../core/utils/index.js";

export type PostInput = { kind: "post"; text: string };
export type DeleteInput = { kind: "delete"; tweet_id: string };
export type SearchInput = { kind: "search"; query: string };
export type LookupInput = { kind: "lookup"; tweet_id: string };
export type XToolInput = PostInput | DeleteInput | SearchInput | LookupInput;

export class XTool {
  private client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  static init(): XTool | null {
    if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
      return null;
    }

    const oauth1 = new OAuth1({
      apiKey: X_API_KEY,
      apiSecret: X_API_SECRET,
      callback: "oob",
      accessToken: X_ACCESS_TOKEN,
      accessTokenSecret: X_ACCESS_TOKEN_SECRET,
    });

    const client = new Client({ oauth1 });
    return new XTool(client);
  }

  async execute(input: XToolInput): Promise<string> {
    switch (input.kind) {
      case "post":
        return this.post(input.text);
      case "delete":
        return this.deleteTweet(input.tweet_id);
      case "search":
        return this.search(input.query);
      case "lookup":
        return this.lookup(input.tweet_id);
    }
  }

  private async post(text: string): Promise<string> {
    const response = await this.client.posts.create({ text });
    if (response.errors?.length) {
      const msg = response.errors.map((e) => e.detail ?? e.title ?? "Unknown error").join("; ");
      throw new Error(`X API error: ${msg}`);
    }
    const tweetId = response.data?.id;
    logger.info({ tweetId }, "Posted to X");
    return `Posted: https://x.com/i/status/${tweetId}`;
  }

  private async deleteTweet(tweetId: string): Promise<string> {
    const response = await this.client.posts.delete(tweetId);
    if (response.errors?.length) {
      const msg = response.errors.map((e) => e.detail ?? e.title ?? "Unknown error").join("; ");
      throw new Error(`X API error: ${msg}`);
    }
    logger.info({ tweetId }, "Deleted from X");
    return `Deleted tweet ${tweetId}`;
  }

  private async lookup(tweetId: string): Promise<string> {
    const response = await this.client.posts.getById(tweetId, {
      tweetFields: ["author_id", "created_at", "conversation_id", "in_reply_to_user_id", "reply_settings"],
    });
    if (response.errors?.length) {
      const msg = response.errors.map((e) => e.detail ?? e.title ?? "Unknown error").join("; ");
      throw new Error(`X API error: ${msg}`);
    }
    if (!response.data) {
      return "Tweet not found";
    }
    const tweet = {
      id: response.data.id,
      text: response.data.text,
      author_id: response.data.authorId,
      created_at: response.data.createdAt,
      conversation_id: response.data.conversationId,
      reply_settings: response.data.replySettings,
    };
    return JSON.stringify(tweet, null, 2);
  }

  private async search(query: string): Promise<string> {
    const response = await this.client.posts.searchRecent(query, {
      maxResults: 10,
      tweetFields: ["author_id", "created_at", "conversation_id"],
    });
    if (response.errors?.length) {
      const msg = response.errors.map((e) => e.detail ?? e.title ?? "Unknown error").join("; ");
      throw new Error(`X API error: ${msg}`);
    }
    if (!response.data?.length) {
      return "No results found";
    }
    const results = response.data.map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      author_id: tweet.authorId,
      created_at: tweet.createdAt,
    }));
    return JSON.stringify(results, null, 2);
  }
}
