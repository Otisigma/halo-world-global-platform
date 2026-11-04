# Express API CORS

The local/container Express server accepts credentialed API requests from these
exact origins:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `https://halo-world-global-platform.netlify.app`
- `https://halomusicworld.com`
- `https://admin.halomusicworld.com`

Add deployment-specific origins with the comma-separated environment variable
`CORS_ALLOWED_ORIGINS`, for example `http://localhost:5173`. Values must be exact
HTTP(S) origins without paths, trailing slashes, credentials, or wildcards.
Invalid configuration stops server startup.

The middleware runs before API handlers, permits OPTIONS preflight, reflects only
an allowed origin, sends `Vary: Origin`, and allows credentials. Untrusted origins
(including `Origin: null` from a file URL) receive 403. Requests without Origin
continue to normal route authentication; absence of Origin is not authorization.
Errors returned by API handlers retain the CORS headers.

The five audio routes retain their own existing public/private CORS and rights
policy rather than receiving global credentialed headers. Public static media
also retains its existing wildcard, non-credentialed policy.

Song Lab already fetches relative `/api/dreamweaver-song-lab` URLs with
`credentials: "same-origin"`. Keep this for same-origin hosting; do not change all
fetches to `include` or point them at an unconfigured API domain. For an explicitly
supported cross-origin cookie API, clients need `credentials: "include"` and the
API must separately support that origin, authentication, CSRF protection, and
appropriate cookie attributes. CORS permission alone does not grant API access.

This Express change does not configure Netlify Functions. The Express server
currently bridges only the Drive catalog APIs; it does not host Song Lab or the
other Netlify APIs. For full-stack local testing use the existing Netlify
development environment (`netlify dev`) and relative API URLs. Do not disable TLS
verification or authentication as a workaround.

Verify with `npm run test:api-cors`. CORS cannot repair DNS resolution, deploy an
unmerged fix, or make a missing route available.
