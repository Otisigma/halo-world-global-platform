export const DNA_DIMENSIONS = Object.freeze({
  sonic: "Sonic identity",
  mood: "Mood",
  influence: "Influences",
  skill: "Skills",
  looking_for: "Looking for",
  collaboration: "Collaboration style"
});

export const DNA_LIMITS = Object.freeze({
  creativeStatement: 600, creativeGoals: 1000, workflowNotes: 1000,
  perDimension: 8, totalTerms: 48, searchTerms: 12, bodyBytes: 18000
});

const selections = {
  sonic: [
    ["atmospheric", "Atmospheric", ["ambient textures"]], ["warm", "Warm", []],
    ["raw", "Raw", []], ["polished", "Polished", []], ["organic", "Organic", []],
    ["electronic", "Electronic", []], ["minimal", "Minimal", []], ["cinematic", "Cinematic", []],
    ["experimental", "Experimental", []]
  ],
  mood: [
    ["uplifting", "Uplifting", ["upbeat"]], ["melancholic", "Melancholic", ["wistful"]],
    ["introspective", "Introspective", []], ["energetic", "Energetic", []],
    ["dreamy", "Dreamy", []], ["dark", "Dark", []], ["playful", "Playful", []],
    ["peaceful", "Peaceful", []], ["intense", "Intense", []]
  ],
  influence: [
    ["house", "House roots", ["house music"]], ["jazz", "Jazz traditions", []],
    ["soul", "Soul traditions", []], ["hip-hop", "Hip-hop roots", ["hip hop"]],
    ["african-rhythms", "African rhythms", []], ["classical", "Classical composition", []],
    ["folk", "Folk storytelling", []], ["dub", "Dub culture", []], ["film", "Film scores", []]
  ],
  skill: [
    ["production", "Production", ["producing"]], ["songwriting", "Songwriting", []],
    ["vocals", "Vocals", ["singing"]], ["mixing", "Mixing", []], ["mastering", "Mastering", []],
    ["sound-design", "Sound design", []], ["arrangement", "Arrangement", []],
    ["instrumentation", "Instrumentation", []], ["visuals", "Visual storytelling", []]
  ],
  looking_for: [
    ["vocalist", "Vocalist", ["singer"]], ["producer", "Producer", []],
    ["songwriter", "Songwriter", []], ["mix-engineer", "Mix engineer", []],
    ["instrumentalist", "Instrumentalist", []], ["visual-artist", "Visual artist", []],
    ["remixer", "Remixer", []], ["feedback", "Constructive feedback", []], ["mentor", "Mentor", []]
  ],
  collaboration: [
    ["remote", "Remote", ["online"]], ["in-person", "In person", ["in person"]],
    ["async", "Asynchronous", ["asynchronous"]], ["live-session", "Live sessions", []],
    ["co-writing", "Co-writing", ["cowriting"]], ["iterative", "Iterative", []],
    ["structured", "Structured briefs", []], ["improvisation", "Improvisation", []],
    ["long-term", "Long-term partnerships", []]
  ]
};

export const DNA_TERMS = Object.freeze(Object.entries(selections).flatMap(([dimension, items]) =>
  items.map(([key, label, aliases]) => Object.freeze({
    id: `${dimension}:${key}`, dimension, key, label, aliases: Object.freeze(aliases)
  }))
));

export const defaultCreativeDna = () => ({
  creativeStatement: "", creativeGoals: "", workflowNotes: "",
  visibility: "private", revision: 0, termIds: []
});
