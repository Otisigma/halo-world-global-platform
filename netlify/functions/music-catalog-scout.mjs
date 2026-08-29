import { getDatabase } from "@netlify/database";
import { auditMusicCatalog } from "../lib/music-catalog-audit.mjs";

export default async function musicCatalogScoutHandler(_request, context) {
  const db = getDatabase();

  try {
    const result = await auditMusicCatalog(db);
    console.log("HALO music catalog audit completed", {
      total: result.total,
      passed: result.passed,
      failed: result.failed
    });

    if (result.failed > 0) {
      console.error(`HALO music catalog audit: ${result.failed} issue(s) found`, result.failures.map(f => f.detail));
    }
  } catch (error) {
    console.error("HALO music catalog scout failed", error instanceof Error ? error.message : "unknown error");
  }
}

export const config = {
  schedule: "0 * * * *"
};
