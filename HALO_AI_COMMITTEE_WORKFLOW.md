# HALO AI Committee Workflow

This workflow adds a skeptical verification loop for AI-delivered work. No single agent self-report is enough for acceptance.

## Purpose

- Require evidence over claims.
- Prefer live-state checks over code-only claims when behavior is user-facing.
- Prevent unverified "done" reports from moving work forward.
- Preserve HALO's supporter-first and trust-first operating posture.

## Roles and responsibilities

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
- Record each outcome with Outcome, Evidence, Learning, Open risk, Next check, and Check by so follow-up accountability is explicit.
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
