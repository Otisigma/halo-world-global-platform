# Halo Journal

Halo Journal is HALO's private, owner-only operational memory. It records meaningful interface actions and technical signals for the authenticated HALO owner, keeps owner-authored notes, recognizes recurring problems, and creates concise AI-assisted reflections that the existing HALO Companion can use for more relevant owner guidance.

## What it records

- Page visits, navigation, button activation, form submission, and slider adjustment
- Audio play, pause, and media errors
- Browser runtime failures, offline transitions, and quality-monitor findings
- Intentional notes entered and saved inside Halo Journal

Halo Journal does not record passwords, payment information, text typed into normal forms, local file contents, IP addresses, or activity outside HALO. Monitoring can be paused from the Journal panel at any time. The panel and API are restricted to accounts with a HALO owner role or an email configured in `HALO_OWNER_EMAILS`.

## Memory behavior

Journal monitoring starts only after the server verifies the authenticated HALO owner. Events are deduplicated, queued during temporary connection loss, and synchronized in small batches. Other visitors and members cannot create, read, or receive companion guidance from journal memory.

Problem signals can trigger an AI reflection at a throttled rate. A user can also request a reflection manually or save a note that explains the goal behind the recent activity. If AI inference is unavailable, Halo Journal produces deterministic troubleshooting guidance from the recent timeline.

## Main files

- `halo-journal.js` provides safe event capture, offline queuing, monitoring controls, notes, timeline, and reflections.
- `netlify/functions/halo-journal.mjs` validates requests, stores journal data, and creates reflections through Netlify AI Gateway.
- `netlify/database/migrations/20260806235000_create-halo-journal.sql` adds event, profile, note, and insight storage.
- `site-monitor.js` loads Halo Journal sitewide and forwards quality findings as problem signals.
- `netlify/functions/halo-companion.mjs` supplies journal memory to the existing companion team.

Run `npm test` to execute the repository audit, including the Halo Journal checks.
