import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "../core/utils/config.js";

export const GEMINI_MODEL = "gemini-3.8-flash";

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
  httpOptions: {
    timeout: 180000,
  },
});

export default ai;
