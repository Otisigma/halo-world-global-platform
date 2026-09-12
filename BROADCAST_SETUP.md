# HALO One-Button Broadcast Setup

The internal venue for live events is `/live-party/` (Dreamweave + fan room + DJ booth). External multistream distribution is optional and controlled from `/halo-live.html`.

The live page sends one protected server-side command to a multistream relay. The relay remains responsible for receiving the encoder feed and distributing it to YouTube, TikTok, and any other enabled destination.

## Live Party access model

`/live-party/` is designed to keep discovery simple while supporting paid growth:

- **Free Discovery**: core listening room, fan chat, and Dreamweave cues stay open for public launch events.
- **Supporter**: unlocks featured DJ sessions and ticketed room routing hooks.
- **VIP**: unlocks private afterparty routing and priority premium room access.

Premium flows are intentionally hook-based (`partyTheme.monetizationHooks`) so the room can launch without hardwiring payment providers. Keep the internal room as the primary venue and use external relays as distribution only.

### Recommended rollout

1. Start with free launch events to build recurring attendance and baseline chat engagement.
2. Enable Supporter hooks for featured/ticketed sessions once weekly cadence is stable.
3. Enable VIP private-room hooks for monthly headline mixes or invite-only sessions.

Configure these Netlify environment variables:

- `HALO_BROADCAST_START_URL`: HTTPS webhook or provider endpoint that starts all relay destinations.
- `HALO_BROADCAST_CONTROL_CODE`: Private code entered by the operator before a broadcast command is sent.
- `HALO_BROADCAST_DESTINATIONS`: Comma-separated display names such as `YouTube,TikTok,Twitch,Facebook`.
- `HALO_BROADCAST_TOKEN`: Optional bearer token sent only from the Netlify Function to the relay.
- `HALO_BROADCAST_STOP_URL`: Optional HTTPS endpoint that ends all destinations and turns the same page button into a stop control while live.

The start and stop endpoints receive a JSON `POST` body with this shape:

```json
{
  "action": "start",
  "destinations": ["YouTube", "TikTok"],
  "source": "halo-live",
  "requestedAt": "2026-08-04T12:00:00.000Z"
}
```

Return any `2xx` response when the command has been accepted. Keep platform stream keys, OAuth credentials, and relay secrets inside the relay or Netlify environment variables; never place them in the site HTML.

Before pressing the button, start the encoder, verify picture and audio in the relay preview, and confirm that the music and guest permissions cover every selected platform.
