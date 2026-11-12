export const HOST_IDS = ["halo-ai-nova", "halo-ai-muse", "halo-ai-echo"];
export const DAILY_TOPICS = [
  "What makes a song stay with you after it ends?",
  "Acoustic, electronic, rock, jazz, hip-hop: what connects your favourite sounds?",
  "What would you put in a late-night listening mix, and why?",
  "What makes a live performance feel personal?",
  "When does silence make a recording more powerful?",
  "What do you notice first: rhythm, lyrics, melody, or texture?",
  "What would make discovering a new independent artist easier?",
  "What recording detail makes you want to listen again?",
  "What does a great opening track do for a playlist?",
  "What makes a lyric feel honest to you?",
  "How would you introduce a friend to a genre they rarely hear?",
  "What do you value in a direct connection with an artist?",
  "What makes a stripped-back recording work?",
  "What music question should the HALO community discuss next?"
];

export function dailyHostTopic(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid community host date");
  const day = now.toISOString().slice(0, 10);
  return { day, topic: DAILY_TOPICS[Math.floor(now.getTime() / 86_400_000) % DAILY_TOPICS.length] };
}

export function validateHostConversation(value) {
  if (!Array.isArray(value?.posts) || value.posts.length !== 3) throw new Error("Daily hosts must produce exactly three posts");
  return value.posts.map((post, index) => {
    if (typeof post !== "string" || !post.trim() || post.trim().length > 320) throw new Error("Daily host post must contain 1–320 characters");
    const body = post.trim();
    if (/https?:|www\.|<[^>]*>|@\w|[\u0000-\u001f]/i.test(body)) throw new Error("Daily host posts cannot contain links, markup, mentions or control characters");
    return { actorId: HOST_IDS[index], body };
  });
}

export async function publishDailyHostConversation(db, { now = new Date(), generate }) {
  const { day, topic } = dailyHostTopic(now);
  const existing = await db.sql`SELECT day FROM community_host_days WHERE day = ${day}::date`;
  if (existing.length) return { published: false, day, reason: "already-published" };
  const posts = validateHostConversation(await generate(topic));
  // The date claim, opener and two replies commit as one statement, including concurrent invocations.
  const rows = await db.sql`
    WITH claimed AS (
      INSERT INTO community_host_days (day, topic) VALUES (${day}::date, ${topic})
      ON CONFLICT (day) DO NOTHING RETURNING day
    ), opener AS (
      INSERT INTO community_messages (actor_id, body)
      SELECT ${posts[0].actorId}, ${posts[0].body} FROM claimed
      RETURNING id
    ), replies AS (
      INSERT INTO community_messages (actor_id, body, reply_to)
      SELECT entry.actor_id, entry.body, opener.id
      FROM opener CROSS JOIN (
        VALUES (${posts[1].actorId}, ${posts[1].body}, 1), (${posts[2].actorId}, ${posts[2].body}, 2)
      ) AS entry(actor_id, body, position)
      ORDER BY entry.position
      RETURNING id
    )
    SELECT id FROM opener UNION ALL SELECT id FROM replies
  `;
  if (rows.length !== 0 && rows.length !== 3) throw new Error("Daily host publication returned an incomplete conversation");
  return { published: rows.length === 3, day, topic, reason: rows.length ? "published" : "already-published" };
}
