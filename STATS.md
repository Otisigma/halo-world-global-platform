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
- Existing events already on the page for follow/support/conversion actions (for example `community_*`, `payment_checkout_started`, and route click events via `data-stat-event`)

Interpretation note: the purpose is to compare the best listener experience and the best artist outcome, consistent with HALO's artist-owned values. Keep Variant A as the brand center while using Variant B as a measurable comparison path.
