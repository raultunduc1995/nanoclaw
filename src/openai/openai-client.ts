import OpenAI from "openai";
import { DEEPSEEK_API_KEY } from "../core/utils/config.js";

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: DEEPSEEK_API_KEY,
});

export default client;
