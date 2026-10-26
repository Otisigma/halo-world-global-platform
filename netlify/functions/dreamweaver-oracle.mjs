import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import OpenAI from "openai";
import { AI_MODELS } from "../lib/ai-governance.mjs";
import { createOracleHandler } from "../lib/dreamweaver-oracle.mjs";

export default createOracleHandler({
  getDatabase, getUser, verifyRequestOrigin,
  async generate({ system, context }) {
    const client = new OpenAI({ maxRetries: 0 });
    const completion = await client.chat.completions.create({
      model: AI_MODELS.council,
      messages: [{ role: "system", content: system }, { role: "user", content: context }],
      response_format: { type: "json_object" },
      max_completion_tokens: 2400
    }, { signal: AbortSignal.timeout(12_000) });
    return completion.choices[0]?.message?.content || "";
  }
});

export const config = { path: "/api/dreamweaver/oracle" };
