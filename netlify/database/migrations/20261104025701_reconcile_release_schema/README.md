This directory retains the Drizzle schema snapshot as a generation baseline.
The original `20261103081706_strong_demogoblin` migration was rejected as out of
order. This replacement uses a newer timestamp and a no-op SQL statement because
all of its schema changes are already covered by earlier SQL migrations:

- `20261008210000_add_song_catalog_lyrics.sql`
- `20261008223000_release_conveyor.sql`
- `20261016010000_dreamweaver_release_assets.sql`
- `20261025150000_song_broadcast_intent.sql`

Keep the snapshot so future Drizzle generation does not recreate these changes.
The SQL file is required by Netlify's migration directory validation. It records
the reconciled baseline without repeating existing schema operations.
