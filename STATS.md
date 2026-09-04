# HALO Stats Backend

The stats backend records anonymous product events in Netlify Database and exposes a protected aggregate report.

## Privacy

- Visitor and browser-session identifiers are random anonymous values stored in the browser.
- Tracking honors the browser's Do Not Track setting.
- Events do not include IP addresses, message text, bug descriptions, music URLs, track names, or email addresses.
- Event names and metadata keys are allowlisted by the server.
- Event ingestion is capped per anonymous browser session to reduce accidental or abusive traffic.
- Event ingestion is capped per anonymous browser session to reduce accidental or abusive traffic.

## Endpoints

`POST /api/stats/events` accepts allowlisted events from the same site. The shared browser client in `stats.js` sends page views and key product actions automatically.

`GET /api/stats/summary?days=30` returns aggregate activity for 1–365 days. It includes visitors, sessions, page views, event totals, daily activity, top pages, and a basic activation funnel.

The summary endpoint requires an environment variable named `STATS_ADMIN_TOKEN`. Send that value as a bearer token:

```bash
curl -H "Authorization: Bearer $STATS_ADMIN_TOKEN" \
  "/api/stats/summary?days=30"
```

If the token is not configured, reporting remains unavailable rather than exposing analytics publicly.

## Radio audience events

The radio console reports listening through the same client using `radio_tune_in`, `radio_heartbeat`, `radio_tune_out`, and `radio_skip`. Their metadata carries only the room, station, track title, artist name, and elapsed seconds — no listener identity beyond the existing anonymous session value. Numeric metadata is validated and clamped server side because listener minutes are summed from it. See `HALO_RADIO.md` for how the aggregates are read.

## Custom Events

Pages can record an existing allowlisted event through the browser client:

```js
window.haloStats?.track("enter_console", { target: "hero" });
```

New event names or metadata fields must also be added to the allowlists in `netlify/lib/stats.mjs` before they are accepted.

## Homepage music experience experiment (native vs quick-listen)

The homepage includes an explicit comparison section to test two approaches:

- **Variant A (primary):** Native HALO artist-home listening and support flow
- **Variant B (comparison):** Quick-listen embed path that routes people back into HALO actions

Use `?musicExperiment=native` or `?musicExperiment=embed` to force a single variant, or load without that parameter for side-by-side comparison.

Instrumentation hooks:

- `homepage_music_experiment_viewed` with metadata `variant` and `view`
- `homepage_music_experiment_exit` with metadata `variant` and `seconds`
- `homepage_music_experiment_action` with metadata `variant`, `mode`, `goal`, and `target` for comparison placeholders:
  - `goal: listening` for native music-home entry
  - `goal: iframe_loaded` for embed iframe load target `homepage_experiment_embed_iframe_loaded` (current quick-listen availability proxy; render-only, not playback intent)
  - `goal: relationship_room` for relationship-room entry in both variants (top-of-funnel handoff before downstream follow actions)
  - `goal: support_actions` for support CTA in both variants
  - `goal: repeat_visits` for the embed continue-in-HALO handoff; compare longer-term revisit rate by variant with `homepage_music_experiment_viewed` and `homepage_music_experiment_exit`
  - downstream supporter-conversion reading should come from existing HALO support events (for example `payment_checkout_started` and related support-route events) joined back to the experiment `variant`
- Existing events already on the page for follow/support/conversion actions (for example `community_*`, `payment_checkout_started`, and route click events via `data-stat-event`)

Recommended comparison view:

| Goal | Variant A target | Variant B target | Reading |
| --- | --- | --- | --- |
| Listening | `homepage_experiment_native_listen` | `homepage_experiment_embed_iframe_loaded` | Compare HALO music-home entry against quick-listen availability until a deeper embed playback signal exists |
| Follows | `homepage_music_experiment_viewed` cohort by `variant`, with `homepage_experiment_native_relationship_room` as the HALO handoff signal | `homepage_music_experiment_viewed` cohort by `variant`, with `homepage_experiment_embed_relationship_room` as the HALO handoff signal | Which variant leads to stronger downstream follow/community actions after the relationship-room handoff |
| Support actions | `homepage_experiment_native_support_action` | `homepage_experiment_embed_support_action` | Which path gets more support-intent clicks |
| Repeat visits | `homepage_music_experiment_viewed` / `homepage_music_experiment_exit` cohort by `variant` | `homepage_music_experiment_viewed` / `homepage_music_experiment_exit` cohort by `variant`, plus `homepage_experiment_embed_continue_halo` as a handoff signal | Which variant brings people back over time, with the embed handoff acting as an immediate supporting signal |
| Supporter conversion | Downstream HALO support/payment events attributed back to the `native` cohort after `homepage_music_experiment_viewed` | Downstream HALO support/payment events attributed back to the `embed` cohort after `homepage_music_experiment_viewed` | Which variant actually moves fans into supporter conversion, beyond CTA intent |

Interpretation note: the purpose is to compare the best listener experience and the best artist outcome, consistent with HALO's artist-owned values. Keep Variant A as the brand center while using Variant B as a measurable comparison path. Use transparent behavior data to improve supporter value and artist outcomes without exploitation.
