# Album Concierge

Album Concierge turns a member's story into a saved album concept with title options, an ordered tracklist, a theme, style references, cover direction, dedication text, and a hidden sleeve note. Members can refine the result, keep it private, create recipient-safe gift or public links, return to earlier work through the Treasury, and print the result as a keepsake.

Collector Edition adds generated cover artwork, a private voice-note upload, and booklet presentation. The checkout uses Stripe Checkout and verifies the returned Checkout Session before activating premium tools.

## Deployment configuration

Configure these environment variables in Netlify before enabling paid Collector Edition checkout:

- `STRIPE_SECRET_KEY`: Stripe restricted or secret key with Checkout Session access.
- `STRIPE_ALBUM_CONCIERGE_PRICE_MINOR`: Collector Edition price in the currency's minor unit, such as cents.
- `STRIPE_ALBUM_CONCIERGE_CURRENCY`: Optional three-letter currency code; defaults to `USD`.

Do not expose these values in browser code. If checkout is not configured, the API keeps the album safe and returns a clear unavailable message instead of granting premium access.

## Storage and access

Session records live in Netlify Database. Generated covers and uploaded voice notes live in Netlify Blobs. Private media requires session ownership; public and gift media requires the unguessable share token and a session whose mode is `public` or `gift`.
