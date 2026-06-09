import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../core/utils/index.js";

export const client = new Anthropic({
  logger: logger.child({ name: "Anthropic" }),
  logLevel: "info",
});
