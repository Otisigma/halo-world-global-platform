import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const releaseMigrationPaths = [
  "netlify/database/migrations/20260828081000_publish-cognitive-erasure.sql",
  "netlify/database/migrations/20260828082000_publish-ill-do-it-all-again.sql",
  "netlify/database/migrations/20260828083000_publish-blessed.sql"
];

const [auditLib, scout, catalogApi, cognitiveErasure, illDoItAllAgain, blessed, mySensitivityLikeACrown] = await Promise.all([
  read("netlify/lib/music-catalog-audit.mjs"),
  read("netlify/functions/music-catalog-scout.mjs"),
  read("netlify/functions/release-catalog.mjs"),
  ...releaseMigrationPaths.map(read),
  read("netlify/database/migrations/20260830000000_publish-my-sensitivity-like-a-crown.sql")
]);

assert.ok(
  releaseMigrationPaths.every(path => path.split("/").at(-1).slice(0, 14) > "20260828080000"),
  "release publish migrations must sort after the applied production migration"
);

assert.match(auditLib, /REQUIRED_RELEASES/, "audit library must define required releases");
assert.match(auditLib, /cognitive-erasure/, "audit library must include Cognitive Erasure in required releases");
assert.match(auditLib, /ill-do-it-all-again/, "audit library must include I'll Do It All Again in required releases");
assert.match(auditLib, /blessed/, "audit library must include Blessed in required releases");
assert.match(auditLib, /distrokid\.com\/hyperfollow\/owenanthony\/cognitive-erasure/, "audit library must reference the correct DistroKid URL for Cognitive Erasure");
assert.match(auditLib, /distrokid\.com\/hyperfollow\/owenanthony\/ill-do-it-all-again/, "audit library must reference the correct DistroKid URL for I'll Do It All Again");
assert.match(auditLib, /distrokid\.com\/hyperfollow\/owenanthony\/blessed/, "audit library must reference the correct DistroKid URL for Blessed");
assert.match(auditLib, /my-sensitivity-like-a-crown/, "audit library must include My Sensitivity Like a Crown in required releases");
assert.match(auditLib, /distrokid\.com\/hyperfollow\/owenanthony\/my-sensitivity-like-a-crown/, "audit library must reference the correct DistroKid URL for My Sensitivity Like a Crown");
assert.match(auditLib, /isValidHttpsUrl/, "audit library must validate that release links are HTTPS URLs");
assert.match(auditLib, /artworkIsMissing/, "audit library must detect releases without any cover artwork set");
assert.match(auditLib, /auditMusicCatalog/, "audit library must export auditMusicCatalog");
assert.match(auditLib, /reportIssue/, "audit library must report broken links or missing artwork through the maintenance issue system");
assert.match(auditLib, /resolveIssue/, "audit library must resolve issues when a check recovers");
assert.match(auditLib, /console\.error/, "audit library must log errors for catalog problems so they appear in function logs");
assert.match(auditLib, /HALO_MUSIC_PAGE/, "audit library must reference the HALO DistroKid music page");
assert.match(auditLib, /direct\.distrokid\.com\/halomusic/, "audit library must know the direct DistroKid halomusic page URL");

assert.match(scout, /auditMusicCatalog/, "scout function must call the audit library");
assert.match(scout, /schedule:/, "scout must be a scheduled function");
assert.match(scout, /console\.error/, "scout must log failures");
assert.match(scout, /getDatabase/, "scout must use the database");
assert.doesNotMatch(scout, /process\.env/, "scout must use Netlify function environment access, not process.env");

assert.match(catalogApi, /artwork_url/, "catalog API must expose artwork fields");
assert.match(catalogApi, /release-link/, "catalog API must route listen clicks through the release-link handler");

assert.match(cognitiveErasure, /'cognitive-erasure'/, "Cognitive Erasure migration must use the correct release ID");
assert.match(cognitiveErasure, /Owen Anthony/, "Cognitive Erasure migration must credit the correct artist");
assert.match(cognitiveErasure, /distrokid\.com\/hyperfollow\/owenanthony\/cognitive-erasure/, "Cognitive Erasure migration must wire the DistroKid hyperfollow URL");
assert.match(cognitiveErasure, /published/, "Cognitive Erasure migration must publish the release");
assert.match(cognitiveErasure, /ON CONFLICT.*DO UPDATE/, "Cognitive Erasure migration must be idempotent");

assert.match(illDoItAllAgain, /'ill-do-it-all-again'/, "I'll Do It All Again migration must use the correct release ID");
assert.match(illDoItAllAgain, /Owen Anthony/, "I'll Do It All Again migration must credit the correct artist");
assert.match(illDoItAllAgain, /distrokid\.com\/hyperfollow\/owenanthony\/ill-do-it-all-again/, "I'll Do It All Again migration must wire the DistroKid hyperfollow URL");
assert.match(illDoItAllAgain, /published/, "I'll Do It All Again migration must publish the release");
assert.match(illDoItAllAgain, /ON CONFLICT.*DO UPDATE/, "I'll Do It All Again migration must be idempotent");

assert.match(blessed, /'blessed'/, "Blessed migration must use the correct release ID");
assert.match(blessed, /Owen Anthony/, "Blessed migration must credit the correct artist");
assert.match(blessed, /distrokid\.com\/hyperfollow\/owenanthony\/blessed/, "Blessed migration must wire the DistroKid hyperfollow URL");
assert.match(blessed, /published/, "Blessed migration must publish the release");
assert.match(blessed, /ON CONFLICT.*DO UPDATE/, "Blessed migration must be idempotent");

assert.match(mySensitivityLikeACrown, /'my-sensitivity-like-a-crown'/, "My Sensitivity Like a Crown migration must use the correct release ID");
assert.match(mySensitivityLikeACrown, /Owen Anthony/, "My Sensitivity Like a Crown migration must credit the correct artist");
assert.match(mySensitivityLikeACrown, /distrokid\.com\/hyperfollow\/owenanthony\/my-sensitivity-like-a-crown/, "My Sensitivity Like a Crown migration must wire the DistroKid hyperfollow URL");
assert.match(mySensitivityLikeACrown, /published/, "My Sensitivity Like a Crown migration must publish the release");
assert.match(mySensitivityLikeACrown, /ON CONFLICT.*DO UPDATE/, "My Sensitivity Like a Crown migration must be idempotent");
assert.match(mySensitivityLikeACrown, /is_chart_eligible/, "My Sensitivity Like a Crown migration must set chart eligibility");
assert.match(mySensitivityLikeACrown, /artwork_url/, "My Sensitivity Like a Crown migration must populate the artwork_url field");
assert.match(mySensitivityLikeACrown, /imported_artwork_url/, "My Sensitivity Like a Crown migration must include imported_artwork_url per the artwork contract");
assert.match(mySensitivityLikeACrown, /artwork_override_url/, "My Sensitivity Like a Crown migration must include artwork_override_url per the artwork contract");
assert.match(mySensitivityLikeACrown, /Radio edit/, "My Sensitivity Like a Crown migration must include a radio edit version");
assert.match(mySensitivityLikeACrown, /Clean version/, "My Sensitivity Like a Crown migration must include a clean version");
assert.match(mySensitivityLikeACrown, /source_release_id|halo_dreamweaver_songs|Dream Weaver/, "My Sensitivity Like a Crown migration must document the Dream Weaver storage path");
assert.match(mySensitivityLikeACrown, /halo_artist_pages/, "My Sensitivity Like a Crown migration must upsert the artist page so the release hero is updated");
assert.match(mySensitivityLikeACrown, /release_url/, "My Sensitivity Like a Crown migration must set artist page release_url to the HyperFollow URL");
// Protect against PR #40 regression: website_url must not duplicate the release HyperFollow URL.
// website_url is for the artist streaming profile; release_url is for the HyperFollow pre-save page.
assert.doesNotMatch(
  mySensitivityLikeACrown,
  /website_url\s*=\s*'https:\/\/distrokid\.com\/hyperfollow\/owenanthony\/my-sensitivity-like-a-crown'/,
  "artist page website_url must not duplicate the release HyperFollow URL — keep release_url and website_url distinct"
);

console.log("Music catalog audit contracts passed.");
