# Dreamweaver Campaign Engine

## What was created

Dreamweaver now includes a campaign cutting room that turns an existing HALO mix into a vertical short-form promotion workflow. The artist can choose a moment from the mix, select a 15, 30, or 45-second format, choose a creative treatment and campaign goal, preview the result in a 9:16 frame, and ask Gemma to prepare the complete publishing package.

Gemma creates separate TikTok, Instagram Reels, and YouTube Shorts material from verified mix information. Each package contains a title, caption, hashtags, description, pinned-comment suggestion, alt text, posting guidance, rights checklist, and tracked destination back to the exact Dreamweaver show. The artist can copy one field, copy the complete post, download the full campaign package, download a cover image, or render the vertical clip in a supported browser.

Campaigns and their performance signals are stored in Netlify Database. The system records generation, copying, downloading, rendering, publication readiness, tracked landings, show starts, listening milestones, and completed mixes. Gemma can review those signals on demand, and a scheduled daily monitor refreshes campaigns when new evidence has arrived.

## The artist experience

The artist begins with a completed mix in the Mix Desk and opens its Dreamweaver edition. The existing show still behaves as a cinematic five-movement listening experience. A new **Make a Reel / Short** action opens the campaign cutting room without sending the artist to another product.

The left side is the creative decision desk. The artist chooses the duration, drags the start point through the mix, selects **The Hook**, **The Story**, or **The Invitation**, chooses the campaign objective, and optionally writes an opening line. The middle of the room shows the vertical Dreamweaver frame with the actual artwork, movement title, mix identity, time position, and call to action. The right side becomes the finished campaign package after Gemma completes the draft.

The package keeps each platform distinct. The artist can edit any field before copying it. **Mark ready to publish** records that a platform package reached the publishing stage without claiming that HALO posted it. The tracked URL returns the audience to the exact mix and records the journey into the full show.

After the campaign collects signals, **Run performance review** asks Gemma’s campaign team to interpret only the measured evidence. The review returns a momentum score, stage, summary, and controlled recommendations. The automated daily monitor performs the same grounded review whenever a campaign has received new events since its last assessment.

## Time to complete a campaign

A first-time artist should expect approximately three to six minutes from opening Dreamweaver to holding a finished campaign package. Choosing the passage and treatment should take 30–90 seconds. Gemma’s package generation should normally take several seconds, depending on inference and network conditions. Reviewing or editing the platform copy should take one to three minutes. Cover export is immediate.

Video rendering happens in real time because the browser plays and records the selected audio passage. A 15-second clip therefore takes roughly 15 seconds plus preparation, a 30-second clip takes roughly 30 seconds, and a 45-second clip takes roughly 45 seconds. The exact downloaded format depends on browser recording support: compatible browsers receive MP4 where supported and WebM otherwise.

## Recommended test journey

1. Sign in to HALO and confirm that a playable room or private mix exists in the Mix Desk.
2. Open `/dreamweaver/?mix=THE_MIX_ID` and confirm that the mix title, creator, duration, five movements, audio controls, and archive material load.
3. Select a musical point in the show and open **Make a Reel / Short**.
4. Choose 30 seconds, move the start slider, and compare all three Dreamweaver treatments.
5. Choose **Start the full mix** as the goal and ask Gemma to build the package.
6. Review TikTok, Instagram, and YouTube separately. Edit one field, copy it, and copy one complete platform post.
7. Download the cover and full campaign text package.
8. Render the vertical clip and confirm that the downloaded video contains the selected audio, moving artwork, Dreamweaver typography, progress signal, and final call to action.
9. Mark one platform package ready to publish and use its tracked destination in a test post or private message.
10. Open the tracked destination in a separate browser session, start the show, pass several listening milestones, and complete the mix if practical.
11. Return while signed in, reopen the saved campaign, and run the performance review. Confirm that the score and recommendations reflect the recorded evidence rather than invented platform performance.

## What is automated now

The working release automated clip planning, live preview, browser-based vertical rendering, cover export, platform-specific copy, hashtags, descriptions, alt text, pinned comments, rights prompts, tracked links, package download, campaign history, first-party performance events, manual evidence review, and scheduled daily monitoring.

Gemma operated as a grounded campaign editor and campaign-team coordinator through Netlify AI Gateway. If inference was unavailable, HALO returned a deterministic verified package instead of blocking the artist or inventing material.

## Current boundaries

Direct posting to social accounts was not enabled because TikTok, Meta, and YouTube each require separate developer applications, permissions, OAuth connections, token handling, account eligibility, and platform review. The interface therefore delivered honest package and assisted-publishing behavior rather than displaying a non-functional publish button. The API and campaign records were structured so connected publishing could be added platform by platform after those approvals were configured.

External social metrics were not yet imported. The first release measured HALO-owned signals and publication readiness. A campaign score therefore described the evidence HALO could verify—landing visits, show starts, listening depth, and completion—not unverified TikTok, Instagram, or YouTube numbers.

Campaign preparation now ran as a persisted background job. The cutting room immediately showed gathering, planning, writing, and packaging stages, and it resumed the active job when the artist reopened the studio. Approved HALO video records could be selected for an archive reel, collage, or single-section treatment; uploaded footage was available to the film renderer while linked video stayed reference-only.

Final film encoding remained a foreground browser task and downloaded the resulting asset to the artist’s device. The renderer combined the chosen mix excerpt with artist-owned uploaded footage when available, then fell back to approved Dreamweaver chapter artwork. It did not yet upload the finished video to Netlify Blobs or encode it in a server-side background function. Browser codec support determined MP4 or WebM output.

## Product ratings after this build

**Originality — 9.5/10.** Dreamweaver remained unlike a conventional visualizer or social scheduler because one emotional artist world connected the full mix, short-form clip, campaign language, destination, and learning loop.

**Visual identity — 9.2/10.** The campaign cutting room preserved Dreamweaver’s editorial typography, artwork, movements, edition language, atmosphere, and cinematic framing instead of replacing them with a generic analytics dashboard.

**Creator simplicity — 8.8/10.** The core journey became unusually direct: choose a moment, ask Gemma, review, render, copy, and publish. The score remained below ten because real-time rendering and manual social posting still required waiting and one external step.

**Campaign completeness — 8.7/10.** The artist received the clip, cover, captions, descriptions, hashtags, alt text, pinned comment, rights prompts, tracked link, and variants in one place. Direct scheduling and platform account connections remained the largest missing pieces.

**Automation — 8.4/10.** Generation, fallback copy, persistence, attribution, milestone tracking, evidence reviews, and daily monitoring were automated. Restricted autopilot and external platform ingestion were intentionally deferred until account permissions and safeguards existed.

**Analytics and feedback — 8.0/10.** The build connected social traffic to meaningful HALO listening behavior and produced evidence-based recommendations. The rating would rise after approved platform metrics, variant comparisons, retention data, and publishing IDs were connected.

**Trust and artist control — 9.3/10.** The system separated drafting, approval, publishing readiness, and measured outcomes. It did not invent achievements or claim that a post had been published, and it kept rights checks visible.

**Production readiness — 8.2/10.** The data model, secured API, grounded AI fallback, responsive interface, contracts, rate limits, and scheduled monitor formed a strong first production release. Cross-browser rendering tests, real social OAuth, background asset storage, and platform API reviews remained before full autopilot.

**Overall — 8.8/10.** This build closed the most important gap between a brilliant Dreamweaver show and a usable promotion system. It became a genuine artist campaign engine rather than a concept, while keeping the remaining platform-dependent work explicit.

## Best next step

The strongest next release would connect one approved social platform end to end. It should add account authorization, draft or scheduled upload, publication ID storage, metric snapshots, and a clear disconnect control. Completing one platform reliably would be more valuable than partially connecting all three.
