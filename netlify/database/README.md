# Database migrations

The Drizzle schema is defined in `db/schema.ts`. Generated migrations and their
snapshots belong in `netlify/database/migrations`, as configured in
`drizzle.config.ts`. Netlify applies SQL migrations automatically during deploys.

This project also has standalone SQL migrations. Drizzle does not include these
changes in its snapshot history automatically. Compare freshly generated SQL
against earlier standalone migrations before accepting it: changes already
provided by those migrations must not be repeated. Retain the newly generated
snapshot so future generation starts from the reconciled schema.

The failed `20261002013224_faulty_retro_girl` migration duplicated the publication
sync table, song-version columns, and single-active-master index from earlier
SQL migrations. It was replaced with `20261002100845_reconcile_song_schema`,
which only adds the missing publication-sync owner index. The generated snapshot
also records the existing Google Drive URL migration, which remains in place.
Previously applied migrations were preserved.

Run `npm run test:database-migrations` to check song schema migrations for
unguarded duplicate table, index, and added-column definitions. This check also
runs in the deploy-health contracts included in `npm test`. Run
`npx drizzle-kit generate` after schema changes, and review the output before
deploying. Do not edit applied migrations or apply migration SQL manually.

Use `netlify db status` to inspect applied and pending migrations. When a preview
database branch exists, `netlify db migrations reset` removes its unapplied
migration files so they can be regenerated. If the branch does not exist, the
command fails; do not reset all historical migration files based on a fresh or
unavailable branch. Only replace migrations confirmed to be pending by the
failed deploy.
