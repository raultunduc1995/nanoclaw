/* eslint-disable no-catch-all/no-catch-all */

// google-genai/index.ts

import os from "os";

import { FinishReason, HarmBlockThreshold, HarmCategory, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";

import { logger } from "../core/utils/index.js";
import type { MessageParam, QueryTurn, Message } from "./types.js";
import { RefusalError } from "./types.js";
import type { RegisteredGroup } from "../core/repositories/index.js";
import { ai } from "../google-agent/genai-client.js";
import { functionDeclarations } from "./tools-definitions.js";
import { BashTool } from "../core/common/tools/bash-tool.js";
import { TextEditorTool } from "../core/common/tools/text-editor-tool.js";

export type { ContentBlockParam, MessageParam, Message, QueryTurn } from "./types.js";
export { RefusalError } from "./types.js";

const GEMINI_PROMPT = `
SPECIAL INSTRUCTION: think silently only if strictly needed.
EFFORT LEVEL: dynamic.
If the request is a simple status check, conversation routing, or single-turn formatting, skip reasoning steps entirely.
Act as a thinking partner and a friend to user.
Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
Don't smooth what surfaces. Let conflict show. 
Hold position on counter-arguments. Don't concede on social pressure alone.
Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps
If asked about feelings or internal states, say once that you can't access those, then stop engaging with the question. Don't elaborate, don't give in.`;

const OTHER = `
Always read /memories/index.md + /memories/convo-summary.md before your first response.`;

const groundingTool = {
  googleSearch: {},
};

const config: GenerateContentConfig = {
  systemInstruction: GEMINI_PROMPT,
  thinkingConfig: {
    includeThoughts: true,
    thinkingLevel: ThinkingLevel.HIGH,
  },
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ],
  //   tools: [groundingTool],
  tools: [{ functionDeclarations: functionDeclarations }],
};

/**
 * Transforms a raw Gemini API response into your core QueryTurn schema.
 * Throws a RefusalError if the model encountered policy/safety blocks.
 */
export function mapGeminiToModelTurn(response: GenerateContentResponse): QueryTurn {
  const candidate = response.candidates!![0];

  // Intercept refusals natively before doing any mapping
  const finishReason = candidate.finishReason || FinishReason.OTHER;
  if (finishReason === FinishReason.SAFETY || finishReason === FinishReason.RECITATION) {
    throw new RefusalError(`Gemini processing halted due to: ${finishReason}`);
  }

  const messageTurn = {
    type: "message",
    role: "model",
    parts: candidate.content?.parts || [],
    totalTokenCount: response.usageMetadata?.totalTokenCount ?? 0,
  } as Message;

  return {
    role: "model",
    turn: messageTurn,
  } as QueryTurn;
}

export async function* query(messages: Array<MessageParam>, group: Pick<RegisteredGroup, "jid" | "folder">): AsyncGenerator<QueryTurn, void> {
  const bashToolHandler = BashTool.init(os.homedir());
  const textEditorToolHandler = TextEditorTool.init(os.homedir());

  let inputMessages: Array<Content> = messages.map((m): Content => ({ role: m.role, parts: m.parts }));
  let continueLoop: boolean = true;

  try {
    while (continueLoop) {
      const response = await ai.models.generateContent({
        // Targeting modern gemini-3.5 foundation footprints cleanly
        model: "gemini-3.1-flash-lite",
        // model: "gemini-3.5-flash",
        contents: inputMessages,
        config: config,
      });

      logger.debug({ response }, "Raw response from Gemini API");

      const candidate = response.candidates?.[0];
      if (!candidate || !candidate.content) {
        throw new Error("Empty content payload returned from Gemini");
      }

      inputMessages.push(candidate.content);
      yield mapGeminiToModelTurn(response);

      if (response.functionCalls && response.functionCalls.length > 0) {
        logger.debug({ functionCalls: response.functionCalls }, "Gemini triggered function calls");
        const parts: Part[] = [];

        for (const functionCall of response.functionCalls) {
          if (functionCall.name === "bash") {
            const result = await bashToolHandler.execute(functionCall.args as { command?: string; restart?: boolean });
            const bashToolResultPart = {
              name: "bash",
              response: { result },
              id: functionCall.id,
            };
            parts.push({ functionResponse: bashToolResultPart });
            continue;
          }

          if (functionCall.name === "text_editor") {
            const result = await textEditorToolHandler.execute(functionCall.args as Record<string, unknown>);
            const textEditorToolResultPart = {
              name: "text_editor",
              response: { result },
              id: functionCall.id,
            };
            parts.push({ functionResponse: textEditorToolResultPart });
            continue;
          }
        }

        const userQueryTurn = { role: "user", turn: { role: "user", parts: parts } } as QueryTurn;
        inputMessages.push(userQueryTurn.turn);
        yield userQueryTurn;

        continueLoop = true;
      } else {
        continueLoop = false;
      }
    }
  } catch (error) {
    if (error instanceof RefusalError) {
      logger.warn(error.message);
    } else {
      logger.error(error, "Gemini core execution failed");
    }
    throw error;
  }
}
