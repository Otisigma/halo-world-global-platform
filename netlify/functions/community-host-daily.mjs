import { getDatabase } from "@netlify/database";
import OpenAI from "openai";
import { publishDailyHostConversation } from "../lib/community-hosts.mjs";
import { recordScheduledHeartbeat } from "../lib/scheduled-heartbeats.mjs";

export async function generateHostConversation(topic) {
  const client = new OpenAI({ timeout: 20000, maxRetries: 0 });
  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 800,
    messages: [
      { role: "system", content: "Write a short daily conversation for clearly labelled HALO AI hosts, not real fans. Exactly three posts, in order: Nova opens the supplied topic with a question; Muse adds a distinct practical perspective; Echo responds to that perspective and invites real listeners to join. Each post is 1–320 characters. Music of every genre is welcome. No claims about listening yourself, personal memories, attendance, activity, live events, releases, artists, products, prices, site features, or news. No fabricated facts, real artist names, lyrics, links, mentions, marketing pressure, medical/legal/financial advice, or promises. Do not pose as humans. Do not address absent users or simulate fan replies. Stick to creative opinions and open questions about the supplied topic. Return JSON only." },
      { role: "user", content: topic }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "halo_daily_hosts", strict: true,
        schema: {
          type: "object", additionalProperties: false,
          properties: { posts: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", minLength: 1, maxLength: 320 } } },
          required: ["posts"]
        }
      }
    }
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Daily host generation returned no content");
  return JSON.parse(content);
}

export default async function communityHostDailyHandler() {
  const db = getDatabase();
  try {
    if (process.env.HALO_COMMUNITY_HOSTS_ENABLED === "false") {
      await recordScheduledHeartbeat(db, "community-host-daily", "success", { skipped: "disabled" });
      return;
    }
    const result = await publishDailyHostConversation(db, { generate: generateHostConversation });
    await recordScheduledHeartbeat(db, "community-host-daily", "success", result);
    console.log("HALO daily AI hosts", result);
  } catch (error) {
    console.error("HALO daily AI hosts failed", error instanceof Error ? error.message : "unknown error");
    await recordScheduledHeartbeat(db, "community-host-daily", "failure", {
      error: error instanceof Error ? error.message : "unknown error"
    });
    throw error;
  }
}

export const config = { schedule: "0 9 * * *" };
