# HALO Sovereign Voice & Concierge

The proposed concierge covers inbound reception and consented milestone
outreach. The current implementation is a limited, private in-app
membership-anniversary card in `/track-drops/`, powered by the authenticated
member's existing membership creation date. It appears on the anniversary's
UTC date, beginning with the first anniversary. For memberships created on
February 29, it appears on February 28 in non-leap years. No new profile data
is collected. The card does not send anything, use AI or issue a reward.

## Not yet implemented

- Calls, phone-number recognition, voicemail, SMS, WhatsApp, and push delivery.
- A voice preference center, consent ledger, quiet-hour scheduler, opt-out
  handling, verified telephone numbers, frequency limits, and delivery audit.
- Gemini Live, persona voices, voice synthesis, inbound triage, knowledge
  retrieval, live-call transfer, Google Calendar booking, and briefings.
- Birthday, release, chart and VIP triggers, stem matchmaking, actual reward
  grants and redemption, delivery retry handling, and engagement metrics.

## Gates before external outreach

Do not treat an in-app celebration, an email preference, or a request payload as
consent to call. Before any outbound pilot, design and implement separately
revocable, purpose- and channel-specific consent tied to a verified destination,
timestamped audit, clear user controls, local-time quiet hours, suppression on
opt-out immediately before dispatch, bounded frequency, idempotent event and
delivery handling, and honest delivery status. Validate timezone and daylight
saving transitions and never log phone numbers, claim tokens, call content, or
unnecessary personal data. Establish retention, deletion and access controls.

Before inbound or outbound audio, configure and verify the telephony and Gemini
providers, disclose AI interaction, authenticate provider callbacks, restrict
agent tools and high-impact actions, design human escalation, and review
applicable privacy, telephone-marketing and recording rules with qualified
advisers. Calendar, messaging and points mutations require explicit
authorization, real integrations and audit; no script may promise an unissued
reward. These requirements are engineering gates, not a claim of legal
compliance.
