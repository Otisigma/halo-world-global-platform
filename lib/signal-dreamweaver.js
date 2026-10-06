import { HaloAIService } from "./halo-ai-service.js";

export const DREAMWEAVER_DISCLOSURE = "Local writing advisory, not a live AI provider or audio/video analysis. Review suggestions before applying. Nothing is published automatically.";

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
