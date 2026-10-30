import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { archiveSong, archiveSongMessage } from "../netlify/lib/song-archive.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [archiveLib, api, page, client, releaseCatalog, releaseLink, radioAudio, publication, conveyorStore, forcePush, songAudio, songArtwork] = await Promise.all([
  read("netlify/lib/song-archive.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("song-catalog/index.html"),
  read("song-catalog/song-catalog.js"),
  read("netlify/functions/release-catalog.mjs"),
  read("netlify/functions/release-link.mjs"),
  read("netlify/functions/radio-audio.mjs"),
  read("netlify/lib/song-publication.mjs"),
  read("netlify/lib/release-conveyor-store.mjs"),
  read("netlify/lib/catalog-force-push.mjs"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-artwork.ts"),
]);

// Server wiring: signed-in membership, same-origin check, owner from membership only.
{
  const handler = api.slice(api.indexOf("export default async function songCatalogHandler("));
  const action = handler.slice(handler.indexOf('payload.action === "archive_song"'), handler.indexOf('payload.action === "recheck_publication"'));
  assert.ok(action.length > 0, "archive_song action is wired into the catalog handler");
  assert.ok(handler.indexOf("if (!user?.id)") < handler.indexOf('payload.action === "archive_song"'), "archive requires a signed-in member");
  assert.ok(handler.indexOf("ensureMembership(nativeDb, user)") < handler.indexOf('payload.action === "archive_song"'), "archive requires membership");
  assert.ok(handler.indexOf("verifyRequestOrigin(request)") < handler.indexOf('payload.action === "archive_song"'), "archive is behind the same-origin mutation check");
  assert.match(action, /const songId = cleanId\(payload\.songId\)/, "song ID is validated");
  assert.match(action, /archiveSong\(nativeDb, membership\.member_id, songId\)/, "owner is taken from the authenticated membership");
  assert.doesNotMatch(action, /payload\.(ownerMemberId|owner_member_id|memberId|owner)\b/, "client-supplied owner IDs are never trusted");
  assert.match(api, /import \{ archiveSong, archiveSongMessage \} from "\.\.\/lib\/song-archive\.mjs"/);
  assert.doesNotMatch(api, /method === "DELETE"|DELETE FROM halo_song_catalog/, "no hard-delete endpoint");
}

// Statement shape: atomic, owner-scoped, no deletion of history or blobs.
{
  const statement = archiveLib.slice(archiveLib.indexOf("const rows = await db.sql`"), archiveLib.indexOf("const result = rows[0]"));
  assert.doesNotMatch(archiveLib, /\bDELETE\b|getStore|\.delete\(|blob(s)?\.del/i, "archive never deletes rows or storage blobs");
  for (const table of ["halo_release_campaign_events", "halo_listening", "halo_dreamweaver_song_reviews", "halo_release_conveyor_events", "halo_song_publication_sync SET", "halo_song_publication_sync sync SET"]) {
    assert.ok(!statement.includes(`UPDATE ${table}`), `${table} history is preserved`);
  }
  assert.match(statement, /WHERE id = \$\{songId\} AND owner_member_id = \$\{ownerMemberId\} AND status = 'active'\s+FOR UPDATE/, "song is locked and owner/state checked");
  assert.match(statement, /UPDATE halo_song_catalog song\s+SET status = 'archived'/);
  assert.match(statement, /UPDATE halo_song_versions version\s+SET status = 'archived'[\s\S]*?version\.song_id IN \(SELECT id FROM archived_song\) AND version\.status = 'active'/);
  const updates = [...statement.matchAll(/UPDATE (halo_[a-z_]+)[\s\S]*?RETURNING/g)].map(match => match[0]);
  assert.equal(updates.length, 5, "song, versions, release, release audio and radio updates share one statement");
  for (const update of updates.filter(update => !update.startsWith("UPDATE halo_song_versions"))) {
    assert.match(update, /owner_member_id = \$\{ownerMemberId\}|member_id = \$\{ownerMemberId\}/, `${update.split("\n")[0]} is scoped to the owner`);
  }
  for (const update of updates.filter(update => !/UPDATE halo_song_(catalog|versions)/.test(update))) {
    assert.match(update, /EXISTS \(SELECT 1 FROM archived_song\)/, `${update.split("\n")[0]} only runs when this request archived the song`);
  }
  const exclusive = statement.slice(statement.indexOf("exclusive_releases AS"), statement.indexOf("hidden_releases AS"));
  assert.match(exclusive, /release\.owner_member_id = \$\{ownerMemberId\}/, "only releases owned by the archiving member are hidden");
  assert.match(exclusive, /other\.source_release_id = release\.id AND other\.id <> \$\{songId\} AND other\.status = 'active'/, "releases still used by another song are left alone");
  assert.match(exclusive, /audio\.owner_member_id <> \$\{ownerMemberId\}/, "releases holding another artist's audio are left alone");
  assert.match(exclusive, /track\.member_id <> \$\{ownerMemberId\} OR track\.master_song_id IS DISTINCT FROM \$\{songId\}/, "releases with other radio submissions are left alone");
  assert.match(exclusive, /page\.owner_member_id <> \$\{ownerMemberId\}/, "releases featured on another artist's page are left alone");
  assert.match(statement, /SET status = 'draft', visibility = 'private', release_stage = 'archived',\s+is_chart_eligible = FALSE/, "hidden releases use existing constrained values");
  assert.match(statement, /UPDATE halo_radio_tracks track\s+SET status = 'held'[\s\S]*?track\.status IN \('preview', 'rotation'\)/, "public radio tracks are held, not deleted");
  assert.doesNotMatch(statement, /play_count|votes_up|ai_score/, "radio analytics are untouched");
}

// Behaviour against a recording database double.
{
  const calls = [];
  const fake = responses => ({ sql: async (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return responses.shift() || []; } });
  assert.deepEqual(await archiveSong(fake([]), "", "song"), { ok: false, status: 400, reason: "invalid_request" });
  assert.equal(calls.length, 0, "invalid requests never touch the database");

  const archived = await archiveSong(fake([[{ songs_archived: 1, versions_archived: 8, releases_hidden: 1, release_audio_archived: 2, radio_tracks_held: 1, shared_releases_left: 0, shared_radio_left: 0 }]]), "owner", "song");
  assert.deepEqual(archived, { ok: true, status: 200, versionsArchived: 8, releasesHidden: 1, releaseAudioArchived: 2, radioTracksHeld: 1, sharedReleasesLeft: 0, sharedRadioLeft: 0 });
  assert.ok(calls.at(-1).values.includes("owner") && calls.at(-1).values.includes("song"));
  assert.match(archiveSongMessage(archived), /History, analytics, and uploaded files were kept/);
  assert.doesNotMatch(archiveSongMessage(archived), /shared/);

  const retry = await archiveSong(fake([[{ songs_archived: 0 }], [{ status: "archived" }]]), "owner", "song");
  assert.deepEqual(retry, { ok: false, status: 409, reason: "already_archived" }, "retries are idempotent and report the existing archive");
  assert.match(calls.at(-1).text, /WHERE id = \? AND owner_member_id = \?/, "already-archived lookup is owner scoped");
  assert.equal(archiveSongMessage(retry), "That song is already archived");

  const foreign = await archiveSong(fake([[{ songs_archived: 0 }], []]), "intruder", "song");
  assert.deepEqual(foreign, { ok: false, status: 404, reason: "not_found" }, "foreign and missing songs are indistinguishable");
  assert.equal(archiveSongMessage(foreign), "That song was not found");

  const shared = await archiveSong(fake([[{ songs_archived: 1, versions_archived: 1, releases_hidden: 0, release_audio_archived: 0, radio_tracks_held: 0, shared_releases_left: 1, shared_radio_left: 1 }]]), "owner", "song");
  assert.match(archiveSongMessage(shared), /2 shared release or radio records were left unchanged/, "shared-record limitation is reported");
}

// Archived songs are excluded from active/public queries and reprocessing.
{
  assert.match(api, /loadCatalog\(ownerMemberId: string\)[\s\S]*?eq\(songs\.status, "active"\)/, "owner catalog lists only active songs");
  assert.match(api, /runDreamweaverReview\(songId: string, ownerMemberId: string\) \{\s+const \[song\][^\n]*eq\(songs\.status, "active"\)/, "reviews skip archived songs");
  assert.match(api, /async function saveVersion\([\s\S]*?eq\(songs\.ownerMemberId, ownerMemberId\), eq\(songs\.status, "active"\)/, "archived songs cannot be edited");
  assert.match(api, /existingVersion\][\s\S]*?eq\(songVersions\.status, "active"\)/, "archived versions cannot be edited");
  assert.match(releaseCatalog, /WHERE release\.status = 'published'\s+AND release\.visibility = 'public'/, "public catalog shows only published public releases");
  assert.match(releaseCatalog, /song\.source_release_id = release\.id\s+AND song\.status = 'active'/, "public catalog never enriches from archived songs");
  assert.match(releaseLink, /song\.status = 'active'/);
  assert.match(radioAudio, /song\.status === "active"/, "radio playback refuses archived catalog songs");
  assert.match(publication, /WHERE song\.id = \$\{songId\}\s+AND song\.owner_member_id = \$\{ownerMemberId\}\s+AND song\.status = 'active'/, "reconciliation skips archived songs");
  assert.match(publication, /WHERE song\.status = 'active'\s+AND song\.pipeline_status = 'published'/, "scheduled repair skips archived songs");
  assert.match(conveyorStore, /owner_member_id = \$\{ownerMemberId\} AND status = 'active'/, "release conveyor skips archived songs");
  assert.match(forcePush, /owner_member_id = \$\{ownerMemberId\} AND status = 'active'/, "force push cannot republish archived songs");
  assert.match(songAudio, /song\.status = 'active' AND version\.status = 'active'/, "catalog audio refuses archived songs");
  assert.match(songArtwork, /song\.status = 'active' AND release\.status = 'published'/, "public artwork refuses archived songs");
}

// UI: named confirmation, duplicate-submit guard, refresh after archive.
{
  assert.match(page, /<button class="quiet-button archive-song-button" id="archiveSongButton" type="button" aria-describedby="archiveSongStatus">Archive song<\/button>/);
  assert.match(page, /id="archiveSongStatus" role="status" aria-live="polite">[^<]*nothing is deleted/);
  assert.match(client, /\$\("#archiveSongButton"\)\.addEventListener\("click",archiveSelectedSong\)/);
  const source = client.slice(client.indexOf("async function archiveSelectedSong("), client.indexOf("function renderPublicationTotals("));
  const button = { disabled: false, textContent: "Archive song", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
  const status = { textContent: "" };
  const prompts = [];
  const requests = [];
  const reloads = [];
  let confirmAnswer = false;
  let release;
  const state = { authenticated: true, selectedId: "song-a", songs: [{ id: "song-a", title: "Beautiful Liar", artistName: "Otis" }] };
  const archive = runInNewContext(`${source}\narchiveSelectedSong`, {
    state, selectedSong: () => state.songs.find(song => song.id === state.selectedId),
    $: selector => selector === "#archiveSongButton" ? button : status,
    window: { confirm: text => { prompts.push(text); return confirmAnswer; } },
    api: payload => { requests.push(payload); return new Promise(done => { release = () => done({ message: "Song archived" }); }); },
    loadCatalog: async (...args) => { reloads.push(args); state.songs = []; },
    message() {},
  });
  await archive();
  assert.equal(requests.length, 0, "cancelling the confirmation sends nothing");
  assert.match(prompts[0], /Archive “Beautiful Liar” by Otis\?/, "confirmation names the song");
  assert.match(prompts[0], /hidden from your active catalog and from public distribution/);
  assert.match(prompts[0], /Historical analytics, audit records, and uploaded audio\/artwork are kept/);
  confirmAnswer = true;
  const first = archive();
  await Promise.resolve();
  assert.equal(button.disabled, true, "button is disabled while archiving");
  await archive();
  assert.equal(requests.length, 1, "duplicate clicks do not resubmit");
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { action: "archive_song", songId: "song-a" }, "client sends only the song ID");
  release();
  await first;
  assert.equal(reloads.length, 1, "catalog state refreshes after archiving");
  assert.equal(reloads[0].length, 0, "refresh does not pin the archived song as the selection");
  assert.equal(button.disabled, false);
  assert.equal(status.textContent, "Song archived");
}

console.log("Song archive contracts passed: owner/origin gating, atomic owner-scoped soft archive, shared-record safety, public exclusion, history preservation, and UI confirmation/refresh.");
