export const RELEASE_STAGES = Object.freeze([
  "intake", "audio_preflight", "metadata_rights", "council",
  "dreamweaver", "documents", "promotion", "distribution_handoff",
]);

export const RELEASE_AGENT_INTENT = Object.freeze({
  version: 1,
  mission: "Preserve pristine masters, enforce metadata and rights compliance, prepare radio, and bind immersive Dreamweaver delivery.",
  stages: RELEASE_STAGES,
  guards: Object.freeze(["owner_scoped", "preserve_originals", "never_infer_rights", "creator_approves_publication"]),
});
