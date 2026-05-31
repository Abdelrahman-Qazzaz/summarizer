import OpenAI from "openai";
import { getBaseEnv } from "../env";

export const openai = new OpenAI({
  apiKey: getBaseEnv().OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});
