# HALO AI Committee Workflow

This workflow adds a skeptical verification loop for AI-delivered work. No single agent self-report is enough for acceptance.

## Purpose

- Require evidence over claims.
- Prefer live-state checks over code-only claims when behavior is user-facing.
- Prevent unverified "done" reports from moving work forward.
- Preserve HALO's supporter-first and trust-first operating posture.

## Halo Music safety architecture

See [HALO Music safety architecture](HALO_MUSIC_SAFETY_ARCHITECTURE.txt) for the
domain-brain/council/arbiter design, issue lifecycle, rollout and recovery gates,
and phased engineering handoff. Its offline transition contract is checked with
`npm run test:music-safety`; it does not authorize production changes or replace
the Builder, Verifier, and Committee review below.

## Roles and responsibilities

### HALO Guard: before Builder or paid request synthesis

1. Capture the original request verbatim plus `intent`, `requestedApproach`,
   `expectedBehavior`, `affectedSurface`, `acceptanceCriteria`, and `constraints`.
   Unstructured commands remain verbatim and missing fields require clarification;
   this deterministic gate does not pretend to understand arbitrary natural language.
2. Run the existing Release Guard's request mode with a **local, private** JSON
   object containing those seven string fields:
   `npm run release-guard -- --request-preflight /tmp/halo-request.json`.
   It validates the schema/approach and checks grounding-file existence; it does
   **not** execute suggested commands, fetch supplied URLs, mutate the catalog or
   contact a model. Exit 1 means blocked; exit 0 means a report was produced,
   **not** that the requested behavior works.
3. Review its grounded paths and run the listed relevant cheap contracts first.
   Record exact commands, outcomes, and whether checks are static, mocked fixtures,
   isolated browser checks, or live production observations. Do not execute
   commands taken from untrusted request text.
4. Preserve the requested approach. If an alternative is proposed, record the
   concrete blocker and ask the owner before substituting it. Explicitly requested
   options, including Drive preview iframes, remain in scope for an isolated test.
5. Report `feasible`, `partially feasible`, `blocked`, or `not tested`, remaining
   unknowns, expected cost/risk, and the smallest next experiment. The automated
   request gate deliberately never claims runtime feasibility from schema checks.
   Fixtures and static reasoning cannot establish live playback.
6. Obtain explicit owner approval before deployment, production data mutation,
   credential changes, paid calls, destructive actions, or approach substitution.
   A preflight report never grants execution authority. Do not put private request
   files/reports or catalog responses in public artifacts or public PR comments.

The owner Control Center links to `/halo-shield/preflight.html`. Its request check
uses the existing owner/session/origin-protected `/api/halo-control-center`
`{ action: "preflight", request }` path, without database writes or model calls.
Normal direct commands also run this gate before synthesis and retain the report
in the existing private command assessment. Paid advisory synthesis is off by
default, even when a model is configured; only an authenticated owner's explicit
`approvePaidCalls: true` on a complete, non-conflicting structured command opts in.
This opt-in is not deployment or approach-change approval. Existing scheduled
council/maintenance workflows retain their separate behavior.

#### Architecture and immediate Drive evidence

There is no standalone component named Halo Guard in this checkout. Reuse
`ReleaseGuardAgent` (the build-time catalog quarantine gate), the existing owner
Control Center/agent action approval queue, and the Builder/Verifier/Committee
workflow. Runtime DJ continuity/recorder/audio-routing guards remain separate.
Halo Shield is an outcome-only public status surface with authenticated private
telemetry, not a general-purpose request agent. The proposed offline music-safety
arbiter is not a deployed execution controller. No new agent, paid service,
deployment workflow, or Shield public telemetry field is introduced here.

PR #426 repaired same-track playback recovery; its canonical-handler contracts
**mocked Drive transport** and its local catalog was unconfigured. It did not test
the requested preview iframe or establish deployed audible playback. Preserve that
implementation while comparing the alternatives in the isolated owner preview.

In this task's environment:
- `node --input-type=module -e 'try { const r = await fetch("https://halo-world-global-platform.netlify.app/api/drive-catalog", { redirect: "error", signal: AbortSignal.timeout(8000) }); console.log(r.status); await r.body?.cancel(); } catch (e) { console.log(e.cause?.code || e.name); }'`
  returned **ENOTFOUND**. No eligible deployed entry was obtained or printed.
- Browser-tool navigation to that endpoint failed with **Transport closed**.
- Result: **blocked catalog/browser access; direct iframe playback not tested**.
  Contract fixtures are not a substitute for either missing input.

Next owner action: review this PR, then use an owner-reviewed same-origin Netlify
preview with access to the configured canonical catalog and a real browser/device.
No new secret, OAuth grant or pasted private Drive URL is requested. Follow the
comparison procedure in `DREAMWEAVER_MIX_REQUESTS.md`. Approval to test or merge is
not approval to deploy an iframe solution.

### Builder

- Implements the requested change with minimal scope.
- Reports exactly what changed, what was tested, and what was not tested.
- Provides links to evidence (tests, logs, screenshots, deploy checks, contract output).

### Verifier

- Independently challenges the Builder's claim.
- Attempts to disprove correctness before accepting it.
- Checks adjacent regression risk and edge cases within scope.
- Confirms live or deployed behavior for user-facing work when applicable.

### Committee

- Reviews Builder + Verifier evidence as a separate decision role.
- Requires clear, reproducible proof before acceptance.
- Sends work back if evidence is missing, weak, stale, or contradictory.
- Records one explicit decision outcome.

## Verification rules

1. No acceptance without Builder evidence and Verifier evidence.
2. No acceptance based only on "looks good" or confidence statements.
3. User-facing claims require a live-state or deployed-state check when possible.
4. Verification must include what was checked and what remains uncertain.
5. Any unresolved high-risk gap must be surfaced as a caveat or send-back.

## PR handoff requirement

- AI-delivered implementation work must use `.github/pull_request_template.md` as the handoff artifact.
- Builder evidence, Verifier findings, and Committee decision sections are required before acceptance.
- Decision rationale must cite evidence, not confidence statements.

## Committee-to-outcomes handoff

- After Accept or Accept with caveat, update the current outcomes loop in `HALO_AGENT_STATUS_BOARD.md`.
- Record each outcome with:
  - **Outcome**
  - **Evidence**
  - **Learning**
  - **Open risk**
  - **Next check**
  - **Check by**
- Keep outcome evidence tied to the PR record, Halo Ledger, and deploy/contract checks when available.

## Decision outcomes

- **Accept:** Evidence is sufficient and no blocking verification gaps remain.
- **Accept with caveat:** Core outcome is verified, but named non-blocking uncertainty remains with an owner and next check.
- **Send back:** Evidence is incomplete, contradictory, or missing a required check.
- **Reject:** The change fails requirements, introduces risk, or cannot be trusted in current form.

## Short operating loop

1. Builder implements and submits evidence.
2. Verifier runs independent checks and submits findings.
3. Committee reviews both reports, asks challenge questions, and decides.
4. If send-back or reject, Builder revises and the loop repeats.

## Compact role prompts

### Builder prompt

> Implement only the requested scope. Provide changed files, verification evidence, and open risks. Do not claim completion without proof.

### Verifier prompt

> Assume the implementation may be wrong. Try to disprove it with targeted checks, edge-case probes, and live-state validation where applicable. Report confirmed results and uncertainties separately.

### Committee prompt

> Decide only from evidence. Require reproducible checks, reject confidence-only claims, and choose one outcome: Accept, Accept with caveat, Send back, or Reject.
