# Copilot instructions for halo-world-global-platform

## Safety and review boundaries
- Work through pull requests and normal code review; do not introduce direct self-push automation to `main`.
- Do not require or use personal access tokens for repository write-back from workflows.
- Keep automation least-privileged and scoped to the minimum required GitHub Actions permissions.

## CI telemetry and deploy behavior
- CI is allowed to generate `public/telemetry.json` from `${{ github.sha }}` and an ISO timestamp as a build artifact.
- Treat telemetry generation as ephemeral CI output unless maintainers explicitly request tracked source changes.
- Trigger Netlify only through `NETLIFY_BUILD_HOOK` when the secret is configured; safely skip when it is absent.

## Repository workflow expectations
- Keep changes small, focused, and easy to review.
- Prefer existing scripts and conventions in `package.json` for validation.
- Never claim unrestricted system access; operate only within repository and workflow boundaries.
