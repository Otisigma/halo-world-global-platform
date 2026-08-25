import OpenAI from "openai";

export const CAMPAIGN_MODEL = String(process.env.HALO_GEMMA_MODEL || "gpt-5.4-mini").trim();

const platformNames = {
  tiktok: "TikTok",
  instagram: "Instagram Reels",
  youtube: "YouTube Shorts"
};

const goalCopy = {
  awareness: "Meet the artist and enter the full Dreamweaver show.",
  full_mix_starts: "Hear the complete mix inside the Dreamweaver show.",
  release_visits: "Enter the artist world and open the featured releases.",
  community_growth: "Join the HALO room and follow the next movement."
};

const templateHooks = {
  hook: "The room changes when this moment arrives.",
  story: "Every mix carries a story beneath the rhythm.",
  invitation: "Step inside the full Dreamweaver edition."
};

function cleanLine(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeHashtags(values, artistName) {
  const supplied = Array.isArray(values) ? values : [];
  const artistTag = `#${artistName.replace(/[^a-z0-9]/gi, "")}`;
  return [...new Set([...supplied, artistTag, "#Dreamweaver", "#HALO", "#DJMix"].map(value => {
    const tag = String(value || "").replace(/[^#a-z0-9_]/gi, "");
    return tag.startsWith("#") ? tag.slice(0, 48) : `#${tag.slice(0, 47)}`;
  }).filter(tag => tag.length > 1))].slice(0, 8);
}

function fallbackPlatforms(input) {
  const hook = cleanLine(input.headline || templateHooks[input.template], 100);
  const cta = goalCopy[input.goal] || goalCopy.full_mix_starts;
  const hashtags = safeHashtags([], input.artistName);
  return Object.fromEntries(Object.entries(platformNames).map(([platform, name]) => {
    const title = platform === "youtube"
      ? `${input.mixTitle} — ${input.artistName} | Dreamweaver Short`
      : `${input.artistName} / ${input.mixTitle}`;
    const caption = `${hook}\n\n${cta}`;
    return [platform, {
      name,
      title: cleanLine(title, platform === "youtube" ? 100 : 150),
      caption,
      description: `${caption}\n\nOpen the full artist-controlled visual mix on HALO: ${input.destinationUrl}`,
      hashtags,
      pinnedComment: `The full ${input.clipDurationSeconds}-second doorway leads to the complete mix on HALO.`,
      altText: `Vertical Dreamweaver artwork for ${input.artistName}'s mix ${input.mixTitle}.`,
      postingNote: platform === "youtube" ? "Attach the full Dreamweaver destination and choose a clear cover frame." : "Keep the opening visual immediate and place the HALO destination in the available profile or post link route."
    }];
  }));
}

function fallbackPackage(input) {
  const sourceTitle = cleanLine(input.youtubeSourceTitle, 120);
  return {
    campaignTitle: sourceTitle ? `${input.mixTitle} / ${sourceTitle}` : `${input.mixTitle} / Dreamweaver signal`,
    campaignIdea: sourceTitle
      ? `Connect the YouTube world of ${sourceTitle} with one cinematic mix moment and the artist's approved HALO gallery.`
      : "Use one cinematic musical moment and the approved HALO gallery as a doorway into the complete artist world.",
    primaryHook: cleanLine(input.headline || templateHooks[input.template], 100),
    alternativeHooks: [
      `This is where ${input.mixTitle} opens up.`,
      `${input.artistName} built a world around this moment.`
    ],
    callToAction: goalCopy[input.goal] || goalCopy.full_mix_starts,
    rightsChecklist: [
      "Confirm promotional rights for the selected audio passage.",
      "Confirm artwork, image, lyric, and contributor approvals.",
      "Review every credit and destination before publishing."
    ],
    platforms: fallbackPlatforms(input)
  };
}

const packageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    campaignTitle: { type: "string" },
    campaignIdea: { type: "string" },
    primaryHook: { type: "string" },
    alternativeHooks: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    callToAction: { type: "string" },
    rightsChecklist: { type: "array", minItems: 3, maxItems: 4, items: { type: "string" } },
    platforms: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(Object.keys(platformNames).map(platform => [platform, {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          caption: { type: "string" },
          description: { type: "string" },
          hashtags: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
          pinnedComment: { type: "string" },
          altText: { type: "string" },
          postingNote: { type: "string" }
        },
        required: ["title", "caption", "description", "hashtags", "pinnedComment", "altText", "postingNote"]
      }]))
    }
  },
  required: ["campaignTitle", "campaignIdea", "primaryHook", "alternativeHooks", "callToAction", "rightsChecklist", "platforms"]
};

function sanitizePackage(value, input) {
  const fallback = fallbackPackage(input);
  const platforms = Object.fromEntries(Object.keys(platformNames).map(platform => {
    const proposed = value?.platforms?.[platform] || {};
    const safeFallback = fallback.platforms[platform];
    return [platform, {
      ...safeFallback,
      title: cleanLine(proposed.title || safeFallback.title, platform === "youtube" ? 100 : 150),
      caption: cleanLine(proposed.caption || safeFallback.caption, 500),
      description: cleanLine(proposed.description || safeFallback.description, 1_200),
      hashtags: safeHashtags(proposed.hashtags, input.artistName),
      pinnedComment: cleanLine(proposed.pinnedComment || safeFallback.pinnedComment, 300),
      altText: cleanLine(proposed.altText || safeFallback.altText, 300),
      postingNote: cleanLine(proposed.postingNote || safeFallback.postingNote, 300)
    }];
  }));
  return {
    campaignTitle: cleanLine(value?.campaignTitle || fallback.campaignTitle, 160),
    campaignIdea: cleanLine(value?.campaignIdea || fallback.campaignIdea, 320),
    primaryHook: cleanLine(value?.primaryHook || fallback.primaryHook, 120),
    alternativeHooks: (Array.isArray(value?.alternativeHooks) ? value.alternativeHooks : fallback.alternativeHooks).slice(0, 2).map(item => cleanLine(item, 120)),
    callToAction: cleanLine(value?.callToAction || fallback.callToAction, 180),
    rightsChecklist: (Array.isArray(value?.rightsChecklist) ? value.rightsChecklist : fallback.rightsChecklist).slice(0, 4).map(item => cleanLine(item, 240)),
    platforms
  };
}

export async function generateCampaignPackage(input) {
  const fallback = fallbackPackage(input);
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: CAMPAIGN_MODEL,
      messages: [
        {
          role: "system",
          content: "You are Gemma, HALO's careful campaign editor. Create grounded short-form campaign copy only from supplied facts. Never invent credits, handles, quotes, achievements, placements, trends, audience figures, or rights. Keep the writing cinematic, direct, artist-led, and distinct across platforms. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            facts: input,
            requiredPlatforms: Object.keys(platformNames),
            instruction: "Prepare one complete post-ready package. Do not repeat the destination URL inside captions because HALO attaches it after validation. Hashtags must be relevant and restrained."
          })
        }
      ],
      response_format: { type: "json_schema", json_schema: { name: "dreamweaver_campaign_package", strict: true, schema: packageSchema } }
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "null");
    return { package: sanitizePackage(parsed, input), model: CAMPAIGN_MODEL, usedFallback: false };
  } catch (error) {
    console.error("Dreamweaver campaign generation used fallback", error instanceof Error ? error.message : "unknown error");
    return { package: fallback, model: "fallback", usedFallback: true };
  }
}

export function campaignReview(metrics, campaign) {
  const landings = Number(metrics.landing || 0);
  const plays = Number(metrics.show_play || 0);
  const completions = Number(metrics.mix_complete || 0);
  const production = Number(metrics.rendered || 0) + Number(metrics.downloaded || 0);
  const playRate = landings ? plays / landings : 0;
  const completionRate = plays ? completions / plays : 0;
  const score = Math.max(0, Math.min(100, Math.round(
    (production ? 15 : 0) +
    Math.min(landings, 20) +
    playRate * 35 +
    completionRate * 30
  )));
  const signals = [];
  if (!production) signals.push("Render or download the first campaign asset so the campaign can leave the studio.");
  if (!landings) signals.push("Publish one prepared variation and use its tracked HALO destination.");
  else if (playRate < 0.35) signals.push("The landing is attracting visits but too few mix starts; strengthen the first-screen play invitation.");
  else signals.push("The tracked landing is converting visitors into listeners; preserve the destination and test a new opening hook.");
  if (plays >= 3 && completionRate < 0.2) signals.push("Listening depth is weak; test a clip that better represents the mix's opening energy.");
  else if (completions) signals.push("Completed listens are present; build the next variation around the same promise without repeating the exact copy.");
  return {
    score,
    grade: score >= 80 ? "leading" : score >= 60 ? "growing" : score >= 35 ? "learning" : "starting",
    summary: `${campaign.title} is ${score >= 60 ? "showing a usable campaign signal" : "still building enough evidence for a confident decision"}.`,
    metrics: { landings, plays, completions, playRate, completionRate },
    recommendations: signals.slice(0, 3),
    confidence: landings >= 10 ? 0.82 : landings >= 3 ? 0.64 : 0.42,
    agentFindings: [
      { agent: "performance_analyst", finding: landings ? `${landings} tracked landing visits are available for comparison.` : "The campaign still needs its first tracked landing visits." },
      { agent: "experiment_designer", finding: "Change one opening, call to action, or posting condition in the next variation." },
      { agent: "artist_strategist", finding: "Protect the Dreamweaver identity while testing a clearer route into the full mix." }
    ],
    reviewedAt: new Date().toISOString()
  };
}

export async function reviewCampaignEvidence(metrics, campaign) {
  const grounded = campaignReview(metrics, campaign);
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: CAMPAIGN_MODEL,
      messages: [
        {
          role: "system",
          content: "You are Gemma coordinating HALO's campaign performance team. Interpret only supplied campaign facts and measured events. Never invent external platform results. Keep recommendations controlled, artist-led, and testable. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({ campaign: { title: campaign.title, goal: campaign.goal, template: campaign.template, duration: campaign.clip_duration_seconds }, measuredEvents: metrics, deterministicAssessment: grounded })
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "dreamweaver_campaign_review",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              recommendations: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              agentFindings: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    agent: { type: "string", enum: ["performance_analyst", "experiment_designer", "artist_strategist"] },
                    finding: { type: "string" }
                  },
                  required: ["agent", "finding"]
                }
              }
            },
            required: ["summary", "recommendations", "confidence", "agentFindings"]
          }
        }
      }
    });
    const proposed = JSON.parse(completion.choices[0]?.message?.content || "null");
    if (!proposed) return { ...grounded, model: "fallback" };
    return {
      ...grounded,
      summary: cleanLine(proposed.summary || grounded.summary, 420),
      recommendations: (proposed.recommendations || grounded.recommendations).slice(0, 3).map(item => cleanLine(item, 280)),
      confidence: Math.min(Number(proposed.confidence || grounded.confidence), grounded.confidence + .1),
      agentFindings: (proposed.agentFindings || grounded.agentFindings).slice(0, 3).map(item => ({ agent: item.agent, finding: cleanLine(item.finding, 280) })),
      model: CAMPAIGN_MODEL
    };
  } catch (error) {
    console.error("Dreamweaver campaign review used fallback", error instanceof Error ? error.message : "unknown error");
    return { ...grounded, model: "fallback" };
  }
}
