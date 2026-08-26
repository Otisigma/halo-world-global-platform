# HALO local setup

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill in the values you need for the features you want to test.

- `STATS_ADMIN_TOKEN` protects aggregate analytics endpoints.
- `HALO_OWNER_EMAILS` grants owner-only access for the control room and related admin tools.
- `MAINTENANCE_AGENT_TOKEN` and `MAINTENANCE_AI_WEBHOOK_URL` enable the maintenance queue.
- `HALO_GEMMA_OPERATOR_URL`, `HALO_GEMMA_OPERATOR_TOKEN`, and `HALO_GEMMA_MODEL` configure the radio operator relay.
- `STRIPE_*` values are required only for payment-link flows.
- `HALO_RADIO_*` values are required only for live radio integrations.
- `OPENAI_API_KEY` is needed only for features that call OpenAI directly.

## 3. Run contract checks

```bash
npm test
```

The contract suite imports `netlify/lib/stats.mjs`, so the stats database dependency is loaded lazily and only resolves inside Netlify runtime codepaths.

## 4. Serve the site locally

This repository is mostly static HTML, CSS, and browser JavaScript. Use your usual local static server or Netlify dev setup if you already have one available. The Netlify functions and database-backed flows require the matching environment variables from `.env`.

## 5. Database migrations

SQL migrations live in `/home/runner/work/halo-world-global-platform/halo-world-global-platform/netlify/database/migrations`. Apply them in order against your Postgres database, and prefer the idempotent roll-forward files already checked into the repository.
