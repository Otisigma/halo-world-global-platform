# HALO music catalog contract (incremental)

This is the current data contract, not a claim that every music workflow has been
consolidated into one table.

## Identities and relationships

- `halo_release_campaigns.id` is the stable release/campaign ID used by public
  release cards and release-kit routes. The row carries its owner,
  publication status, visibility, campaign metadata, and public destinations.
- `halo_song_catalog.id` is the stable song ID for uploaded/catalogued music.
  `halo_song_catalog.source_release_id` links a song to its release campaign;
  `halo_song_versions.song_id` links versions to that song. Keep those IDs and
  relations; do not clone a release into a second catalog or auto-merge by title.
- `/api/release-catalog` is the current public release read service. It selects
  only `halo_release_campaigns` rows with `status = 'published'` and
  `visibility = 'public'`, then enriches a linked release with active song,
  version, publication-sync, and engagement data when those relations exist.
  Unlinked campaigns remain release-catalog records; not every record has a
  song/version relation.
- `halo_song_publication_sync` records release/radio/Dreamweaver publication
  progress. `halo_release_house_projects` and
  `halo_release_house_submissions` are separate work/review records, not public
  releases. In particular, a pending submission's `smart_link_url` is not a
  published catalog destination. Artist pages, radio tracks, mixes, rooms, and
  chart eligibility retain their own IDs and relations; this change does not
  merge or copy them.

## Destination and review semantics

- `halo_release_campaigns.purchase_url` is the catalog's distribution or
  streaming destination. The existing public `distributionUrl` is exposed only
  when the release is published/public and the URL passes the shared
  `validateSmartLink` HTTPS/host/path validator. The Stream / DSPs card action
  consumes this field, not `official_url`, artist profile URLs, `stream_url`,
  or Release House submission links.
- `official_url` (and artist-page `release_url`) remains the campaign/artist
  listening or official link. It is not copied into `purchase_url` by this
  editor. Audio `stream_url` remains a media reference, not a DSP destination.
- The campaign editor's distribution-link action updates only
  `halo_release_campaigns.purchase_url`, after same-origin, authenticated owner
  checks and server-side smart-link validation. Empty input clears it. It does
  not change owner, release/rights/metadata state, visibility, publication,
  radio, or Release House review state. Owners can see missing, invalid,
  private, and public-card-eligible link status plus the source field and
  release visibility for their releases.
- Draft/private releases remain excluded from `/api/release-catalog`; saving a
  link does not publish them. “Public-card eligible” describes database
  visibility and URL validation only. A supplied URL is not evidence of rights,
  distribution, availability, royalties, or verified metadata.
- Public payloads must not include private media credentials or signed storage
  URLs. Artwork, ISRC/UPC, rights, metadata, and audio/version data are included
  only through their existing sources and gates; this editor does not infer or
  import them. No third-party URL is fetched, scraped, or proxied.

## Archiving a song

The Song Catalog **Archive song** action (`/api/song-catalog`,
`action: "archive_song"`) is a soft archive, not a delete. It requires a
signed-in member and a same-origin request, and the owner always comes from
the authenticated membership. Missing and other members' songs both return
404; a retry on an already archived song returns 409 and changes nothing.

In one atomic, owner-scoped statement it:

- sets `halo_song_catalog.status` and the song's active `halo_song_versions`
  rows to `archived`, which removes them from the owner catalog, publication
  reconciliation, the release conveyor, force push, and catalog audio/artwork;
- hides a linked release (via `source_release_id` or the publication sync row)
  as `draft`/`private`/`release_stage = 'archived'`, not chart-eligible, which
  also hides its Stream / DSPs link. This happens only when the archiving member
  owns the release and no other song, sync row, other artist's audio, other
  radio submission, or other artist's page uses it;
- archives this owner's `halo_release_audio_versions` rows for the song's own
  blobs, and moves this owner's `preview`/`rotation` radio tracks for the song
  to `held`.

Shared or foreign releases and radio tracks are left unchanged and the response
reports how many were skipped. Release events, listening analytics, play
counts, Dreamweaver reviews, conveyor receipts, publication sync history, and
all audio/artwork blobs are kept. `status` is unconstrained text, so no
migration is needed. There is no hard-delete, storage cleanup, restore, or
automatic re-publication.

## Current editor and follow-up seams

Artists manage the public card destination in the existing Release campaign
editor in HALO's Radio + DJ Release Room. The artist-page “Artist listening /
official link” field still serves its separate artist-page action. Existing
Release House submissions continue through review; counsel terms, rights,
mastering, and publication gates are unchanged.

This bounded change reuses existing IDs, relationships, and `purchase_url`, so
it needs no schema migration. A broader one-catalog readiness dashboard and
cross-surface integration of existing artist pages, Release House, radio,
mixes/versions, charts, and publication/conveyor state remain follow-up work;
they require explicit source/provenance rules rather than copying all records
into one table.
