# HALO One-Button Broadcast Setup

The live page sends one protected server-side command to a multistream relay. The relay remains responsible for receiving the encoder feed and distributing it to YouTube, TikTok, and any other enabled destination.

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
