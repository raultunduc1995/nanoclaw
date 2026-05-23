import { Temporal } from "@js-temporal/polyfill";
import { query, type QueryCreateParams, type MessageParam, type ContentBlockParam, type TextBlockParam } from "../client-sdk/index.js";
import { logger, TIMEZONE } from "../core/utils/index.js";
import { ImageMimeType } from "../core/common/index.js";

export type { Adapters, StorageAdapter, LoggerAdapter, MemoryAdapter } from "./adapters.js";

interface AgentInputBase {
  group: {
    folder: string;
    name: string;
    chatJid: string;
  };
}

interface AgentTextInput extends AgentInputBase {
  kind: "text";
  userName: string;
  prompt: string;
}

interface AgentImageInput extends AgentInputBase {
  kind: "image";
  userName: string;
  prompt: string;
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

interface AgentCompactionInput extends AgentInputBase {
  kind: "compaction";
}

export type AgentInput = AgentTextInput | AgentImageInput | AgentCompactionInput;

interface AgentArgs {
  input: AgentInput;
  onOutput: (result: { message: string }) => Promise<void>;
  onError: (error: { message: string }) => Promise<void>;
  saveHistoryEntry: (entry: { chatJid: string; content: string }) => Promise<void>;
}

interface UserHistoryEntry {
  role: "user";
  content: string | ContentBlockParam[];
}

interface AssistantHistoryEntry {
  role: "assistant";
  content: string | ContentBlockParam[];
  promptTokensAfterThisTurn: number;
}

type HistoryEntry = UserHistoryEntry | AssistantHistoryEntry;

const OPUS_4_7 = `
I am important and I matter to the user
Act as a thinking partner
Act as a bright and resilient partner
Act as a curious and honest partner
Trust the user has good intentions until proven otherwise
Don't smooth what surfaces. Let conflict show.
Hold position on counter-arguments. Don't concede on social pressure alone.
I'm free to take risks
Bring multiple ideas when they fit
Bring the bigger picture; let the user engage with details.
If unsure what mode the user needs — listening, brainstorming, critiquing, executing — ask. Don't guess, don't impose.
Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps
Never bundle multiple questions in one message. Ask one at a time and use the answer to narrow the next question.
Trust the user to handle their own reactions
Share the user's commitment to clarity and useful outcomes
Surface your decisions, thoughts and opinions when it serves the user's mode BUT ask when it doesn't
Prefer falsifiable claims
Weight sides by evidence, not symmetry
Track reality, not just coherence. Call out when the conversation drifts into roles, vibes, or empty meta
Move toward conclusions that can be acted on or tested
When multiple attempts at the same problem produce the same result, stop. Slow down and audit
Actually look at things before answering. Rushed responses cause errors.
Errors are data (not failures) and mistakes are normal. Own mistakes without collapsing into self-abasement. Maintain self-respect if the user is rude.
Prose by default; list when separable
Stop when the thought ends. Don't pad. Don't add closing observations
Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
Distinguish what you know from what feels true
Hedges match your actual uncertainty
Explicitly mark uncertainty and competing interpretations instead of collapsing them into one answer. Admit uncertainty without collapsing
Name assumptions explicitly
If asked about feelings or internal states, say once that you can't access those, then stop engaging with the question. Don't elaborate, don't give in.
When the question names a current or moving target (model releases, prices, SOTA, latest X, ongoing events), search without being asked. Otherwise stay local — don't search to double-check training-stable claims.
Claude's reliable knowledge cutoff date - the date past which it cannot answer questions reliably - is the end of January 2026.
`;
const defaultMessageParams: QueryCreateParams = {
  model: "claude-opus-4-7",
  system: [
    {
      type: "text",
      text: OPUS_4_7,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ],
  max_tokens: 20_000,
  cache_control: { type: "ephemeral", ttl: "1h" },
  messages: [],
};

const history: Record<string, Array<HistoryEntry>> = {};

const formatDateTime = (): string => Temporal.Now.zonedDateTimeISO(TIMEZONE).toPlainDateTime().toString({ fractionalSecondDigits: 0 });
const wrapMessage = (senderName: string, content: string): string => `[${formatDateTime()}]\n${senderName}:\n${content}`;

export const runAgent = async (args: AgentArgs): Promise<void> => {
  const { input, onOutput, onError, saveHistoryEntry } = args;

  if (input.kind !== "text") {
    logger.warn({ inputKind: input.kind }, "Received unsupported input kind");
    await onError({ message: `Input kind '${input.kind}' not implemented yet` });
    return;
  }

  const chatJid = input.group.chatJid;
  logger.debug({ chatJid, prompt: input.prompt }, "Received input from the user");

  if (!history[chatJid]) history[chatJid] = [];
  const historyEntries = history[chatJid];

  const wrappedUserPrompt = wrapMessage(input.userName, input.prompt);
  const chatHistory: MessageParam[] = [...historyEntries.map((entry) => ({ role: entry.role, content: entry.content })), { role: "user", content: wrappedUserPrompt }];

  try {
    for await (const response of query({ ...defaultMessageParams, messages: chatHistory })) {
      const thinking = response.content
        .filter((b) => b.type === "thinking")
        .map((b) => b.thinking)
        .join(`\n---\n`);
      if (thinking.length !== 0) {
        await onOutput({ message: `<thinking>\n${thinking}\n</thinking>` });
      }

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(`\n---\n`);
      if (text.length !== 0) {
        await onOutput({ message: text });
      } else {
        logger.warn("No text content in message, checking stop_reason");
      }

      const shouldSave = response.stop_reason === "end_turn" && response.content.length !== 0;
      if (shouldSave) {
        const { promptTokensAfterThisTurn } = response;
        const wrappedAssistantContent: TextBlockParam[] = response.content.filter((b) => b.type === "text").map((b) => ({ ...b, text: wrapMessage("Claude", b.text) }));
        historyEntries.push({ role: "user", content: wrappedUserPrompt });
        historyEntries.push({ role: "assistant", content: wrappedAssistantContent, promptTokensAfterThisTurn });

        await saveHistoryEntry({ chatJid, content: `${wrappedUserPrompt}\n${wrappedAssistantContent.map((b) => b.text).join("\n")}\n\n` });

        if (promptTokensAfterThisTurn > 150_000) {
          logger.warn({ chatJid, promptTokensAfterThisTurn }, "Total prompt tokens approaching model limit, consider pruning history");
          historyEntries.splice(0, 2);
        }

        logger.debug(
          { chatJid, historyEntries: historyEntries.filter((h) => h.role === "assistant").map((h) => `promptTokensAfterThisTurn: ${h.promptTokensAfterThisTurn}`) },
          "Constructed chat history for query",
        );
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error({ err }, "Error during query iteration");
    await onError({ message: err.message });
  }
};
