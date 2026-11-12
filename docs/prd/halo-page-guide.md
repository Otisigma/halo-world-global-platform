# HALO page guide

Open **Ask HALO**, then **Walk this page / Explain a button**. Search visible
controls, select one for an explanation and gold highlight, or start a sequential
walkthrough. Previous/next step move through the visible controls in document
order. End walkthrough, Escape, closing the help section, or closing Ask HALO
clears the highlight. Open a collapsed section and use Refresh controls to
include its controls. Replaced or hidden targets are cleared, not acted on.

The existing companion mounts the guide through the shared site monitor.
Pages without that monitor mount the companion directly. Email templates and
independently deployed satellites are not part of this rollout.

The guide uses existing `data-halo-guide` annotations first, then authored
route-specific help in `lib/halo-guide-content.js`. Unannotated controls receive
conservative control-type help, explicitly saying when detailed behavior is
unknown. This is not exhaustive authored documentation of every workflow.
To extend guidance, add `data-halo-guide` and `data-halo-guide-title` beside the
control, or add a selector and explanation to the route's shared help.

The server's existing AI companion receives only server-authored page facts
for grounding, not DOM content or form values. The walkthrough does not require
an AI request, and never clicks page controls, submits forms, plays audio,
uploads, buys, or publishes. Search and control labels remain in the browser.
Private fields' values are not inspected. Existing companion chat privacy,
authentication, rate limits, and voice options are unchanged.

Personal playlists are included in the same rollout: local browser storage
only, no device sync or shared playlist links. The guide must not describe
browser-local playlists as a hosted community playlist service.

Validate with `node scripts/halo-page-guide-contracts.mjs`, companion/HUD
contracts, and the repository build. The page guide stylesheet uses static
highlighting without animation; native controls and focus remain available.
