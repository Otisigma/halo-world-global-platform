// A song has exactly one canonical master copy: its active `sale_master` version.
// These helpers keep that resolution deterministic so catalog APIs never pick by recency.
export const MASTER_VERSION_TYPE = "sale_master";

/**
 * Picks the single canonical master from a song's active versions.
 * Uploaded audio wins, then the oldest row, then a stable id tiebreak.
 */
export function pickCanonicalMaster(versions) {
  return (Array.isArray(versions) ? versions : [])
    .filter(version => version?.versionType === MASTER_VERSION_TYPE)
    .sort((a, b) => {
      const audioRank = Number(Boolean(b.audioUrl)) - Number(Boolean(a.audioUrl));
      if (audioRank) return audioRank;
      const createdRank = (a.createdAt?.getTime?.() || 0) - (b.createdAt?.getTime?.() || 0);
      return createdRank || String(a.id).localeCompare(String(b.id));
    })[0] || null;
}

/** Serializes the canonical master copy for owner-facing catalog responses. */
export function serializeMasterCopy(versions) {
  const master = pickCanonicalMaster(versions);
  return {
    versionType: MASTER_VERSION_TYPE,
    versionId: master?.id || "",
    uploaded: Boolean(master?.audioUrl),
    audioUrl: master?.audioUrl || "",
    audioFilename: master?.audioFilename || "",
    audioByteSize: master?.audioByteSize || 0,
    durationSeconds: master?.durationSeconds || 0,
    masteringStatus: master?.masteringStatus || "not_started",
  };
}
