// google-genai/types.ts

import { FinishReason, type Part } from "@google/genai";

// Core content blocks
export type ContentBlockParam = Part;

export interface MessageParam {
  role: "user" | "model";
  parts: Array<ContentBlockParam>;
}

export interface Message {
  type: "message";
  role: "user" | "model";
  parts: Array<ContentBlockParam>;
  totalTokenCount: number;
}

// Discriminator wrapper remains intact so your downstream orchestration loop works seamlessly
export type QueryTurn = { role: "user"; turn: MessageParam } | { role: "model"; turn: Message };

export class RefusalError extends Error {
  constructor(message = "Gemini refused to process this request due to safety or policy blocks") {
    super(message);
    this.name = "RefusalError";
  }
}
