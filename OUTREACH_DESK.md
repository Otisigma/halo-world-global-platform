# HALO Outreach Desk

The `halo_relationship_*` tables are an inbound CRM. Every row keys on a `member_id` and describes someone who already joined HALO — their stage, their consent, the notes the team keeps on them. That system cannot represent a radio programmer who has never heard of us, and it should not: getting a record out to radio, DJs, press, playlists, labels, and sync is the opposite motion, aimed at people who have not asked to hear from us at all.

The Outreach Desk is that outbound motion. It reads the release catalogue, scores contacts against a specific record, drafts an approach grounded in that record's own facts, and hands the owner a queue. It sends nothing.

## The rule that governs everything else

**HALO holds no mail credentials and never sends.** A drafted approach becomes `approved` only when the owner approves it, and the database refuses to store an approved or sent approach without the member id of the person responsible:

```sql
CHECK (status NOT IN ('approved', 'sent') OR approved_by_member_id IS NOT NULL)
CHECK (status <> 'sent' OR (sent_by_member_id IS NOT NULL AND sent_at IS NOT NULL))
```

`sent` is not something the platform does. It is the owner recording what they did, from their own mail, after copying the approved text. That is the seam where a human takes over, and it is enforced in the schema rather than in a handler or a prompt, so no future function, model, or scheduled job can route around it.

## Why the constraints are the product

These approaches land in the inboxes of real professionals who did not opt in. Getting that wrong does not produce a bug report — it produces a blocked sender, a burned contact, and a complaint against an artist whose record we were supposed to be helping. So the protections are database constraints rather than good intentions:

| Guarantee | How it is enforced |
| --- | --- |
| One approach per contact per release | `UNIQUE (release_id, target_id)` |
| No contact without recorded provenance | `CHECK (char_length(source_note) BETWEEN 4 AND 300)` on a `NOT NULL` column |
| An opt-out is always dated | `CHECK (contact_status <> 'opted_out' OR opted_out_at IS NOT NULL)` |
| No approach that cites nothing | `CHECK (cardinality(signal_keys) BETWEEN 1 AND 8)` |
| Somewhere real to send it | `CHECK (contact_email <> '' OR contact_url <> '')` |

Two further protections run inside the statements that write and approve, rather than as checks beforehand, so a contact whose status changes mid-run is still refused:

- The insert selects `FROM halo_outreach_targets WHERE contact_status = 'active' AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - make_interval(days => min_days_between_contacts))`. A contact who opts out between selection and write never receives the draft.
- Approval joins the target and requires `t.contact_status = 'active'`. A draft written yesterday cannot be approved for someone who opted out today.

An opt-out is also retroactive: recording one archives every approach still queued for that contact in the same action.

## Frequency caps belong to the contact

`min_days_between_contacts` sits on the target, defaults to 45 days, and can be set anywhere from 7 to 365. Someone who asks to be approached less often gets less often, permanently, without anyone needing to remember. The cap starts running when the owner records an approach as sent, which is the only moment the platform knows a contact was actually used.

## Fit is computed, never asked of the model

`scoreTargetFit` in `netlify/lib/outreach.mjs` is deterministic: the same contact and the same release always produce the same score and the same reasons. The owner can argue with a number before a single word is drafted, and a weak match cannot be talked up by a persuasive paragraph. This is the same discipline as `buildSetPlan` for radio and `momentumScore` for artist teams.

Five weighted axes, 100 points:

- **Genre overlap, 30.** The strongest single predictor of whether an approach is welcome.
- **Tempo lane, 20.** Only meaningful when both the release BPM and the contact's range are known.
- **Territory, 10.** A match beats global, global beats a mismatch.
- **Asset readiness, 20.** Each contact kind needs a different thing to exist — radio needs the radio kit, press needs the press kit, DJs need the DJ kit. A press contact with no press kit is not a lead.
- **Recorded responsiveness, 20.** Placements count most, replies count, and a contact approached repeatedly with no reply is pushed down with a visible suggestion to rest them.

**Unknown is scored neutrally, never punished.** A contact with no stated genres or no tempo range gets the neutral middle and the score says so, exactly as an unlabelled musical key scores neutrally in radio programming. A thin contact record is missing information, not a bad match.

**Eligibility is a gate, not a weighting.** Opted out, bounced, paused, inside the frequency cap, already pitched this release, or missing the required asset — each of these makes a contact ineligible outright. A perfect-fit contact who opted out is not a high score to be balanced against other factors. The two concepts never mix.

## The seats

Four working seats and a critic that is not one of them:

- **Prospect** decides which contacts genuinely fit and says plainly which do not.
- **Angle** finds the reason *this* contact would care about *this* record, rather than a reason anyone would care.
- **Pen** writes the approach in the register that contact actually reads.
- **Cadence** sets when to approach, when a follow-up is warranted, and when to stop asking.
- **Ledger** drops everything ungrounded, generic, or non-compliant, and hands over a queue that can be sent as written.

## The grounding gate

Every draft must cite `signalKeys` drawn from an index built from the release and the contact — roughly two dozen keys, each tied to a real column. `groundPitch` checks those keys in code, after the model, and drops anything that fails. Empty values never become citable signals, so a model cannot cite a press kit that does not exist.

Four ways a draft dies before anyone sees it:

1. **It cites nothing**, or cites a key that is not in this index.
2. **It makes a claim the platform has no standing to make** — guaranteed, viral, chart-topping, millions of streams, and similar. HALO cannot promise a station anything on an artist's behalf.
3. **It does not address the contact by name.** If the draft would read identically to any other recipient, it is a mailshot wearing a pitch's clothes.
4. **It is too short to be real or too long to be read.**

The desk is also told that declining is a good outcome. When it cannot find a specific honest reason a contact should hear a record, it returns `recommendApproach: false` with a reason, and that contact is skipped. The run briefing reports how many drafts were dropped and why, so the filter is visible rather than implied.

## When inference is unavailable

The run still completes, but it produces an honest skeleton carrying a visible marker that the specific reason is missing, and the run is stored as `partial`. The owner sees "this run was partial" in the briefing. A confident letter nobody wrote is never produced.

## Cost

Every run records `input_tokens`, `output_tokens`, `inference_calls`, and `fallback_calls`, and the desk header shows what the last run cost. Outreach has a real per-draft inference cost and it is tracked the same way artist agent runs are, so the economics are visible rather than assumed.

## The desk starts empty, on purpose

**No contacts are seeded.** Contact details for real DJs, stations, journalists, and labels are not something to invent. A plausible-looking address for a real person is worse than an empty table, because someone would eventually send to it. A contract test asserts the migration contains no `INSERT INTO halo_outreach_targets` so this cannot quietly change later.

The list is filled by the owner, from contacts they actually hold — people they have met, stations that publish a submission address, editors whose work they know — and each one records where it came from before it can be stored.

## Lawful basis

Each contact carries one of `public_professional_listing`, `legitimate_interest`, or `consent`, alongside the mandatory provenance note. For UK and EU business-to-business outreach to professional contacts this is the record that matters, together with honouring opt-outs immediately and permanently, which the schema enforces.

This is the structure that supports compliance. It is not legal advice, and it does not replace taking some: before the first campaign goes out at volume, the lawful basis and the opt-out wording are worth twenty minutes with someone qualified.

## Operation

- `outreach-desk.mjs` serves `/api/outreach-desk` and is **owner-only**. There is no tier that opens it to members: a mistake here lands in a stranger's inbox with HALO's name on it. Manual runs are capped at two per hour.
- `outreach-weekly.mjs` runs Tuesdays at 09:40 UTC across published releases in a window from 28 days before to 35 days after release date, up to six releases and eight approaches each. Outside that window a cold approach is a worse use of a contact's attention and of their frequency cap.
- `/outreach.html` is the desk: metrics, the release selector, the run briefing, the approval queue, and the contact list.

## The loop that makes it better

Recorded outcomes feed straight back into the next fit score. A contact who replies scores higher next time; a contact who places a record scores higher again; a contact approached repeatedly with no reply is pushed down and flagged for resting. The desk gets better at *choosing*, which matters considerably more than getting faster at writing.
