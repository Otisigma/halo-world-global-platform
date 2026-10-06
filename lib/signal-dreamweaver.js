import { HaloAIService } from "./halo-ai-service.js";

export const DREAMWEAVER_DISCLOSURE = "Local writing advisory, not a live AI provider or audio/video analysis. Review suggestions before applying. Nothing is published automatically.";

export const RELEASE_CAPTION_MAX_LENGTH = 1000;
const GENERATED_LINE = /^(?:🎵|🔥|🎧)/u;
const HASHTAG = /#[\p{L}\p{N}_]{1,40}/gu;
const toHashtag = value => {
  const words = String(value || "").normalize("NFKC").match(/[\p{L}\p{N}]+/gu) || [];
  const tag = words.map(word => word[0].toUpperCase() + word.slice(1)).join("").slice(0, 40);
  return tag ? `#${tag}` : "";
};

// Builds a release caption only from the creator's own seed text; no genre, mood or link is invented.
export function formatReleaseCaption(raw, { link = "", maxLength = RELEASE_CAPTION_MAX_LENGTH } = {}) {
  const lines = String(raw ?? "").split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!lines.length) return "";
  const seed = lines[0].replace(/^🎵\s*/u, "").replace(HASHTAG, "").replace(/\s+/g, " ").trim();
  const [title, ...rest] = seed.split(/\s+[-–—|]\s+/);
  const details = rest.join(" ");
  const bpm = (details || seed).match(/\b(\d{2,3})\s*bpm\b/i)?.[1] || "";
  const genre = details.replace(/\b\d{2,3}\s*bpm\b/ig, "").replace(/^[\s,·/]+|[\s,·/]+$/g, "").replace(/\s+/g, " ");
  const notes = lines.slice(1).filter(line => !GENERATED_LINE.test(line) && !/^#/.test(line) && !/^https?:\/\//i.test(line));
  const tags = [...new Set([
    ...lines.flatMap(line => line.match(HASHTAG) || []),
    toHashtag(title), toHashtag(genre), "#NewMusic"
  ].filter(Boolean))].slice(0, 6);
  const meta = [bpm && `${bpm} BPM`, genre].filter(Boolean).join(" · ")
    || lines.find(line => line.startsWith("🔥"))?.replace(/^🔥\s*/u, "") || "";
  const listen = `🎧 Listen to full quality audio & release details${link ? `: ${link}` : " on the HALO Signal Network."}`;
  const build = extra => [`🎵 ${title || lines[0]}`, meta && `🔥 ${meta}`, ...extra, listen, tags.join(" ")].filter(Boolean).join("\n\n");
  const keep = [...notes];
  let caption = build(keep);
  while (caption.length > maxLength && keep.length) { keep.pop(); caption = build(keep); }
  return caption.length > maxLength ? caption.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/, "").trimEnd() : caption;
}

export async function suggestSignal(action, draft) {
  const body = draft.body.trim();
  const title = draft.attachment?.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  if (action === "caption") {
    return { text: body || (title ? `Inside the studio: ${title}. What do you hear?` : "A new idea from the studio. What do you hear?"), summary: "Caption draft from your text and attachment name." };
  }
  if (action === "tags") {
    const existing = [...body.matchAll(/#[\p{L}\p{N}_]+/gu)].map(match => match[0]);
    const words = body.toLowerCase().match(/\b(?:ambient|house|techno|jazz|soul|remix|acoustic|electronic|studio|collaboration)\b/g) || [];
    return { tags: [...new Set([...existing, ...words.map(word => `#${word}`)])].slice(0, 6),
      summary: "Tags extracted from your caption only; no genre is inferred from media." };
  }
  if (action === "polish") {
    if (!body) throw new Error("Write a caption before polishing.");
    return { text: body.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n"),
      summary: "Spacing polished without changing your words or voice." };
  }
  if (action === "breakdown") {
    const review = HaloAIService.councilReview({});
    return { summary: [
      `${body.length}/1000 caption characters.`,
      draft.attachment ? `${draft.attachment.type}, ${(draft.attachment.size / 1024 / 1024).toFixed(2)} MB. Check playback and provide a transcript or video description in your caption.`
        : "No uploaded clip. Catalog audio and external links are resolved separately.",
      draft.visibility === "PUBLIC" ? "Public Frequency: anyone can read this post." : `${draft.visibility === "INNER_CIRCLE" ? "Inner Circle" : "Collaborator Vault"}: only you and your selected members can read this post.`,
      ...review.recommendations
    ].join("\n") };
  }
  throw new Error("Unknown Dreamweaver action");
}
