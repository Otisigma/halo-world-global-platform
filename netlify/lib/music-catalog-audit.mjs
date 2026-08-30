import { issueKeyForFingerprint, reportIssue, resolveIssue } from "./maintenance.mjs";

export const HALO_MUSIC_PAGE = "https://direct.distrokid.com/halomusic/";

export const REQUIRED_RELEASES = [
  {
    id: "cognitive-erasure",
    title: "Cognitive Erasure",
    artist: "Owen Anthony",
    officialUrl: "https://distrokid.com/hyperfollow/owenanthony/cognitive-erasure"
  },
  {
    id: "ill-do-it-all-again",
    title: "I'll Do It All Again",
    artist: "Owen Anthony",
    officialUrl: "https://distrokid.com/hyperfollow/owenanthony/ill-do-it-all-again"
  },
  {
    id: "blessed",
    title: "Blessed",
    artist: "Owen Anthony",
    officialUrl: "https://distrokid.com/hyperfollow/owenanthony/blessed"
  },
  {
    id: "my-sensitivity-like-a-crown",
    title: "My Sensitivity Like a Crown",
    artist: "Owen Anthony",
    officialUrl: "https://distrokid.com/hyperfollow/owenanthony/my-sensitivity-like-a-crown"
  }
];

function isValidHttpsUrl(value) {
  if (!value || typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function artworkIsMissing(release) {
  const { artwork_url = "", imported_artwork_url = "", artwork_override_url = "" } = release;
  return !artwork_url.trim() && !imported_artwork_url.trim() && !artwork_override_url.trim();
}

function checkRecord(release, passed, category, detail) {
  return { release, passed, category, detail };
}

export async function auditMusicCatalog(db) {
  const rows = await db.sql`
    SELECT
      id,
      title,
      artist,
      official_url,
      artwork_url,
      imported_artwork_url,
      artwork_override_url,
      preview_url,
      status
    FROM halo_release_campaigns
    WHERE status = 'published'
    ORDER BY updated_at DESC
  `;

  const checks = [];

  for (const row of rows) {
    const label = `"${row.title}" by ${row.artist}`;

    if (!isValidHttpsUrl(row.official_url)) {
      checks.push(checkRecord(row.id, false, "missing-link",
        `Release ${label} (${row.id}) has no valid official_url. Add a DistroKid hyperfollow or streaming link so listeners can reach the music.`));
    } else {
      checks.push(checkRecord(row.id, true, "link", `Release ${label} has a valid official link.`));
    }

    if (artworkIsMissing(row)) {
      checks.push(checkRecord(row.id, false, "missing-artwork",
        `Release ${label} (${row.id}) has no cover artwork. Set artwork_url, imported_artwork_url, or artwork_override_url so the image displays correctly on the music page.`));
    } else {
      checks.push(checkRecord(row.id, true, "artwork", `Release ${label} has cover artwork.`));
    }
  }

  for (const required of REQUIRED_RELEASES) {
    const present = rows.some(row => row.id === required.id);
    if (!present) {
      checks.push(checkRecord(required.id, false, "missing-release",
        `Required release "${required.title}" by ${required.artist} (${required.id}) is not published. Run the migration to add it and wire its official URL: ${required.officialUrl}`));
    } else {
      const row = rows.find(r => r.id === required.id);
      const officialUrl = row.official_url || "";
      if (!isValidHttpsUrl(officialUrl)) {
        checks.push(checkRecord(required.id, false, "missing-link",
          `Required release "${required.title}" (${required.id}) has no valid official_url. Expected: ${required.officialUrl}`));
      } else if (!officialUrl.startsWith(required.officialUrl.split("?")[0])) {
        checks.push(checkRecord(required.id, false, "wrong-link",
          `Release "${required.title}" (${required.id}) official_url does not match the expected DistroKid link. Expected: ${required.officialUrl}`));
      } else {
        checks.push(checkRecord(required.id, true, "required-release", `Required release "${required.title}" is present and linked correctly.`));
      }
    }
  }

  const failures = checks.filter(check => !check.passed);
  const passed = checks.length - failures.length;

  for (const check of checks) {
    const fingerprint = `music-catalog-audit:${check.category}:${check.release}`;
    const issueKey = issueKeyForFingerprint(fingerprint);
    if (check.passed) {
      await resolveIssue(issueKey, check.detail);
    } else {
      console.error(`HALO music audit failed [${check.category}] ${check.release}: ${check.detail}`);
      await reportIssue({
        source: "scheduled",
        category: "music",
        severity: check.category === "missing-release" ? "high" : "medium",
        title: `Music catalog issue: ${check.category} for ${check.release}`,
        details: check.detail,
        pagePath: "/music/",
        fingerprint,
        metadata: { releaseId: check.release, checkCategory: check.category }
      });
    }
  }

  return { total: checks.length, passed, failed: failures.length, failures };
}
