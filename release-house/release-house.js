const rooms = [
  {
    key: "idea", name: "Idea Room", short: "Idea", title: "Give the song a reason to exist.",
    intro: "Before equipment, artwork, or release dates, decide what this song is trying to make someone feel. A clear emotional promise becomes your compass when later choices get noisy.",
    learn: "A concept is not a perfect story. It is one honest sentence describing the moment, feeling, or question at the centre of the song.",
    example: "The Cold Is Lasting Longer began as: ‘A relationship has ended, but the emotional winter has not.’ That line guided the pacing, lyrics, and artwork.",
    next: "Describe the song in one sentence.",
    fields: [
      { id: "workingTitle", label: "Working title", placeholder: "Untitled is allowed", required: true },
      { id: "finishDate", label: "Finish target", type: "date", help: "This is a creative finish date, not necessarily the public release date." },
      { id: "concept", label: "The song in one sentence", type: "textarea", wide: true, placeholder: "This is a song about…", required: true },
      { id: "feeling", label: "What should the listener feel?", placeholder: "Relieved, understood, energised…", required: true },
      { id: "listener", label: "Who needs this song?", placeholder: "Someone driving home after…", required: true }
    ]
  },
  {
    key: "writing", name: "Writing Room", short: "Writing", title: "Find the line people carry home.",
    intro: "Writing is where the idea becomes a repeatable experience. You do not need to know theory to shape a clear beginning, development, hook, and ending.",
    learn: "A hook can be a lyric, melody, rhythm, or sound. The test is simple: after one listen, what is the part someone can remember or recognise?",
    example: "A useful structure might be intro, verse, pre-chorus, chorus, verse, chorus, bridge, final chorus. It is a tool, not a rule.",
    next: "Write the strongest hook or central line.",
    fields: [
      { id: "hook", label: "Hook or central line", type: "textarea", wide: true, placeholder: "Write the line, phrase, or melodic idea here.", required: true },
      { id: "structure", label: "Current structure", type: "select", required: true, options: ["", "Still exploring", "Verse / chorus", "Loop or evolving arrangement", "Instrumental journey", "Other structure"] },
      { id: "lyricDraft", label: "Lyrics or section notes", type: "textarea", wide: true, placeholder: "Paste a draft or list what each section needs to say." },
      { id: "melodyRecorded", label: "I captured the melody or main musical idea somewhere safe", type: "checkbox", wide: true, required: true }
    ]
  },
  {
    key: "recording", name: "Recording Room", short: "Record", title: "Capture the performance—not perfection.",
    intro: "Choose the simplest recording path that can communicate the song clearly. A prepared phone recording can be more useful than an expensive session without a plan.",
    learn: "Record in a quiet space, leave headroom, avoid clipping, and save every useful take. Name files so another person can understand them without asking you.",
    example: "A clear file name looks like: ColdIsLasting_VocalLead_Take03_2026-08-13.wav. ‘final_final2.wav’ does not help your future self.",
    next: "Choose the recording path you can actually complete.",
    fields: [
      { id: "recordingPath", label: "Recording path", type: "select", required: true, options: ["", "Phone or portable demo", "Home recording setup", "Producer's studio", "Commercial studio", "Remote collaboration", "AI-assisted sketch with Suno"] },
      { id: "spacePlan", label: "Where and how", type: "textarea", wide: true, placeholder: "Room, equipment, people, and anything you need to prepare.", required: true },
      { id: "humanContribution", label: "What stays unmistakably yours?", type: "textarea", wide: true, placeholder: "Your lyric, melody, vocal, performance, arrangement decisions, edits, production, or other human contribution.", help: "Complete this when any generative tool helps shape the recording." },
      { id: "generationRecord", label: "Generation record", type: "textarea", wide: true, placeholder: "Tool, model or version, date, prompt, selected output, and edits made.", help: "Keeping a provenance note supports honest credits and later rights review." },
      { id: "sessionDate", label: "Next recording session", type: "date" },
      { id: "filesNamed", label: "My recorded files use clear names", type: "checkbox", required: true },
      { id: "backupReady", label: "I have a second copy of important recordings", type: "checkbox", required: true }
    ]
  },
  {
    key: "production", name: "Production Room", short: "Produce", title: "Build the world around the song.",
    intro: "Production decides what enters, what leaves, and how the listener travels through the track. Every layer should serve the song’s emotional promise.",
    learn: "Arrangement is the timeline of the song. Production is the sound and performance of everything on that timeline. Stems are grouped audio exports used for mixing, performance, or alternate versions.",
    example: "If the final chorus should feel larger, save something for it: an extra harmony, wider synth, stronger drums, or a moment of silence before it lands.",
    next: "Name what changes from the first minute to the last.",
    fields: [
      { id: "references", label: "Reference tracks", type: "textarea", wide: true, placeholder: "List 2–3 songs and exactly what you are learning from each." },
      { id: "arrangement", label: "Arrangement journey", type: "textarea", wide: true, placeholder: "What enters, leaves, grows, or changes as the song moves?", required: true },
      { id: "productionGap", label: "Biggest unfinished production decision", placeholder: "The drums still need…" },
      { id: "stemsExported", label: "My final production and stems are clearly exported", type: "checkbox", wide: true, required: true }
    ]
  },
  {
    key: "mix", name: "Mix + Master Room", short: "Finish", title: "Make the song travel well.",
    intro: "Mixing balances the parts. Mastering prepares the finished mix for playback and delivery. The goal is not simply loudness—it is translation across real listening systems.",
    learn: "Check the song quietly, loudly, in mono, on headphones, on speakers, and somewhere ordinary such as a phone or car. Problems that repeat are worth fixing.",
    example: "For distribution, a high-resolution WAV is the safest final master. Keep the uncompressed master even if you also create MP3 preview files.",
    next: "Listen once without touching any controls.",
    fields: [
      { id: "mixStatus", label: "Current finish stage", type: "select", required: true, options: ["", "Rough mix", "Mix revision", "Mix approved", "Mastering", "Master approved"] },
      { id: "masterFormat", label: "Final master format", placeholder: "For example: 24-bit WAV, 44.1 kHz", required: true },
      { id: "listeningNotes", label: "Translation notes", type: "textarea", wide: true, placeholder: "What did you hear on headphones, phone, speakers, and in mono?" },
      { id: "noClipping", label: "The final master plays cleanly without unintended clipping", type: "checkbox", required: true },
      { id: "masterBackedUp", label: "The approved master is backed up", type: "checkbox", required: true }
    ]
  },
  {
    key: "rights", name: "Rights + Credits Room", short: "Rights", title: "Protect the people behind the record.",
    intro: "Credits and agreements are easier before money, attention, or deadlines arrive. Record who contributed, what they own, and what still needs permission.",
    learn: "Songwriting ownership and master ownership are different. Samples, beats, featured performances, and producer terms can each require clear permission.",
    example: "A split conversation should name every writer and total 100%. If anyone disagrees, pause and resolve it before release submission.",
    next: "List every person who helped create the song.",
    fields: [
      { id: "contributors", label: "Contributors and roles", type: "textarea", wide: true, placeholder: "Name — songwriter, producer, vocalist, musician, engineer…", required: true },
      { id: "splitStatus", label: "Songwriter split status", type: "select", required: true, options: ["", "One writer — confirmed", "Multiple writers — agreed", "Conversation still needed", "Not sure who counts as a writer"] },
      { id: "sampleStatus", label: "Samples, loops, or leased beats", type: "select", required: true, options: ["", "None used", "Used and licensed", "Permission still needed", "Not sure"] },
      { id: "generativeAudioStatus", label: "Generative audio status", type: "select", required: true, options: ["", "No generative audio used", "Generative audio used — provenance recorded", "Generative audio used — rights review needed", "Not sure"] },
      { id: "agreementsSaved", label: "Relevant permissions and agreements are saved in writing", type: "checkbox", wide: true, required: true }
    ]
  },
  {
    key: "identity", name: "Identity + Artwork Room", short: "Artwork", title: "Give the song a visible world.",
    intro: "Artwork should feel like the same emotional world as the music and remain recognisable at thumbnail size. Your artist story should help someone care without exaggeration.",
    learn: "Avoid unlicensed images, unreadable text, platform logos, URLs, or claims that could cause store rejection. Keep a high-resolution square source file.",
    example: "The broken heart in snow visual for The Cold Is Lasting Longer turns the song’s emotional winter into one immediate image.",
    next: "Describe the cover before designing it.",
    fields: [
      { id: "artDirection", label: "Cover direction", type: "textarea", wide: true, placeholder: "Subject, colour, mood, composition, and what should be avoided.", required: true },
      { id: "artworkLocation", label: "Artwork file or working link", placeholder: "Store approved covers as /assets/releases/<release-slug>.jpg" },
      { id: "artistBio", label: "Short artist biography", type: "textarea", wide: true, placeholder: "Who are you, what do you make, and why does this release matter now?", required: true },
      { id: "rightsConfirmed", label: "I have permission to use every visual element", type: "checkbox", required: true },
      { id: "thumbnailChecked", label: "The artwork still works when viewed very small", type: "checkbox", required: true }
    ]
  },
  {
    key: "metadata", name: "Metadata Room", short: "Metadata", title: "Make one source of truth.",
    intro: "Metadata is the information attached to the release. Build it once here so titles, credits, spelling, and ownership lines stay consistent everywhere.",
    learn: "Store names and credits exactly as they should appear. Version names belong in a version field—not inside the main title unless the distributor specifically asks for that format.",
    example: "Title: The Cold Is Lasting Longer. Artist: Owen Anthony. Version: Original. Genre: Electronic. Content: Clean.",
    next: "Confirm the exact public artist and track names.",
    fields: [
      { id: "officialTitle", label: "Official track title", required: true },
      { id: "artistName", label: "Primary artist name", required: true },
      { id: "version", label: "Version", placeholder: "Original, radio edit, remix…" },
      { id: "genre", label: "Primary genre", required: true },
      { id: "language", label: "Lyrics language", required: true, placeholder: "English, instrumental…" },
      { id: "contentRating", label: "Explicit content", type: "select", required: true, options: ["", "Clean", "Explicit", "Instrumental"] },
      { id: "songwriterCredits", label: "Songwriter credits", type: "textarea", wide: true, required: true },
      { id: "producerCredits", label: "Production and performance credits", type: "textarea", wide: true },
      { id: "copyrightLines", label: "Copyright lines", type: "textarea", wide: true, placeholder: "℗ master owner and year / © composition or artwork owner and year" },
      { id: "metadataChecked", label: "Names and credits match the agreed rights information", type: "checkbox", wide: true, required: true }
    ]
  },
  {
    key: "distributor", name: "Distributor Match Room", short: "Match", title: "Choose the business model—not the logo.",
    intro: "Distributors deliver music to streaming services, but their fees, revenue shares, collaboration tools, and long-term terms differ. Choose for your actual release pattern.",
    learn: "Annual unlimited plans can suit frequent releases. One-time release fees can suit artists who release less often. Free plans may exchange lower upfront cost for a revenue share or fewer services.",
    example: "Compare official terms for DistroKid, CD Baby, TuneCore, UnitedMasters, and any local alternative on the day you choose. Plans can change.",
    next: "Decide whether you prefer annual, one-time, or revenue-share costs.",
    fields: [
      { id: "budgetModel", label: "Preferred cost model", type: "select", required: true, options: ["", "Annual subscription", "One-time release fee", "Free with revenue share", "I need help comparing"] },
      { id: "releaseFrequency", label: "Expected release frequency", type: "select", required: true, options: ["", "One release this year", "2–4 releases this year", "5 or more releases this year", "Not sure yet"] },
      { id: "priorities", label: "What matters most?", type: "textarea", wide: true, placeholder: "Keeping 100%, collaborator splits, label services, support, speed, legacy catalog…", required: true },
      { id: "selectedDistributor", label: "Current choice", placeholder: "No decision is also a valid answer", required: true },
      { id: "termsChecked", label: "I reviewed current terms on the distributor’s official site", type: "checkbox", required: true }
    ]
  },
  {
    key: "upload", name: "Upload Walkthrough Room", short: "Upload", title: "Submit slowly. Check twice.",
    intro: "Distributor forms turn your release record into store data. Use this room beside the distributor screen so you do not invent answers under pressure.",
    learn: "Upload only from your own distributor account. HALO should never need your distributor password. Leave enough lead time for delivery, profile access, corrections, and pitching.",
    example: "For a future campaign, choose a release date several weeks ahead where possible. The sample release date of August 10, 2026 has already passed and should not be copied for a new release.",
    next: "Choose a future release date with breathing room.",
    fields: [
      { id: "submissionDate", label: "Planned upload date", type: "date", required: true },
      { id: "releaseDate", label: "Official release date", type: "date", required: true },
      { id: "storePlan", label: "Target services", type: "textarea", wide: true, placeholder: "Spotify, Apple Music, TikTok, Bandcamp, regional services…", required: true },
      { id: "distributorUrl", label: "Distributor release or pre-save link", placeholder: "Add it after submission" },
      { id: "audioUploaded", label: "The approved master was uploaded and previewed", type: "checkbox", required: true },
      { id: "artUploaded", label: "The approved artwork was uploaded and previewed", type: "checkbox", required: true },
      { id: "submissionChecked", label: "Titles, credits, date, and content rating were checked before submission", type: "checkbox", wide: true, required: true }
    ]
  },
  {
    key: "campaign", name: "Campaign Room", short: "Campaign", title: "Give people a reason to lean in.",
    intro: "A campaign is a sequence of useful invitations, not repeated demands to stream. Different people need different context: fans, DJs, radio, press, and collaborators.",
    learn: "Build from one clear story, then adapt the delivery. A fan needs emotion and a simple link. A DJ needs audio details and versions. Press needs context and verified credits.",
    example: "HALO can turn this source record into fan, DJ, radio, press, and private-preview release rooms without duplicating the release information.",
    next: "Write a two-sentence reason to listen now.",
    fields: [
      { id: "releasePitch", label: "Two-sentence release pitch", type: "textarea", wide: true, required: true },
      { id: "coreAudience", label: "First audience", placeholder: "Who are the first 25 people who should hear it?", required: true },
      { id: "campaignMoment", label: "Main campaign moment", placeholder: "Preview room, live session, story, event…" },
      { id: "assets", label: "Campaign pieces prepared", type: "checkgroup", required: true, options: ["Fan smart link", "Short-form video", "DJ pack", "Radio pack", "Press story", "Private preview", "Email or direct message"] }
    ]
  },
  {
    key: "releaseDay", name: "Release Day Room", short: "Launch", title: "Open every door and listen.",
    intro: "Release day is a verification day before it is a celebration day. Check playback, names, artwork, credits, links, artist profiles, and the place you are sending people.",
    learn: "Store delivery can vary. If something is missing or wrong, record the exact platform, link, and issue before contacting distributor support. Do not panic-post incomplete information.",
    example: "Your first message can be personal: what the song means, why it exists now, and where to hear it. Gratitude travels further than a command.",
    next: "Open the live release link as if you were a fan.",
    fields: [
      { id: "liveUrl", label: "Main live release link", required: true },
      { id: "releaseMessage", label: "Release-day message", type: "textarea", wide: true, required: true },
      { id: "linksChecked", label: "Audio, artwork, title, and links were checked on live services", type: "checkbox", required: true },
      { id: "profilesChecked", label: "Artist profiles and credits were checked", type: "checkbox", required: true },
      { id: "supportersThanked", label: "Collaborators and early supporters were thanked", type: "checkbox", required: true }
    ]
  },
  {
    key: "afterRelease", name: "After Release Room", short: "Continue", title: "Turn one release into a practice.",
    intro: "A song does not stop needing care after launch day. Follow up without flooding people, learn from real responses, and leave an organised record for the next release.",
    learn: "Review at 24 hours, 7 days, 30 days, and 90 days. Look for useful signals—not just large numbers. Replies, saves, repeat listeners, DJ interest, and completed opportunities all teach you something.",
    example: "One release can continue through alternate edits, live versions, behind-the-song notes, radio follow-up, DJ conversations, and a better plan for the next song.",
    next: "Write the first lesson you want to remember.",
    fields: [
      { id: "firstLesson", label: "What did this release teach you?", type: "textarea", wide: true, required: true },
      { id: "weekOneAction", label: "7-day follow-up", type: "textarea", wide: true, required: true },
      { id: "dayThirtyGoal", label: "30-day goal", type: "textarea", wide: true, required: true },
      { id: "nextSong", label: "What happens next?", placeholder: "Rest, new single, alternate version, live show…", required: true },
      { id: "releaseRecorded", label: "I saved the final files, links, credits, outcomes, and lessons", type: "checkbox", wide: true, required: true }
    ]
  }
];

const emptyProject = () => ({
  id: "guest", projectName: "Untitled first release", artistName: "", trackTitle: "", targetReleaseDate: "",
  currentRoom: 1, completedRooms: [], roomData: {}, status: "active", connections: {}
});

const sampleProject = () => ({
  id: "sample", projectName: "The Cold Is Lasting Longer — completed example", artistName: "Owen Anthony",
  trackTitle: "The Cold Is Lasting Longer", targetReleaseDate: "2026-08-10", currentRoom: 1,
  completedRooms: rooms.map((_, index) => index + 1), status: "released", connections: {},
  roomData: {
    idea: { workingTitle: "The Cold Is Lasting Longer", finishDate: "2026-07-18", concept: "A relationship has ended, but the emotional winter has not.", feeling: "Understood, suspended, and quietly hopeful", listener: "Someone living through the long silence after a breakup" },
    writing: { hook: "The cold is lasting longer / since you left the room", structure: "Loop or evolving arrangement", lyricDraft: "Sparse lyric fragments arrive as the production slowly opens.", melodyRecorded: true },
    recording: { recordingPath: "Home recording setup", spacePlan: "Lead vocal recorded close and intimate at home; additional textures captured with the producer.", humanContribution: "Original songwriting, vocal performance, arrangement, production decisions, and final edits.", generationRecord: "No generative audio used.", sessionDate: "2026-06-22", filesNamed: true, backupReady: true },
    production: { references: "Late-night electronic records with patient builds; Afrobeat percussion that creates motion without crowding the vocal.", arrangement: "Cold open, restrained pulse, percussion enters gradually, emotional lift near the final third, long atmospheric release.", productionGap: "Resolved: the final lift needed warmth without becoming triumphant.", stemsExported: true },
    mix: { mixStatus: "Master approved", masterFormat: "24-bit WAV, 44.1 kHz", listeningNotes: "Low end held together in mono; vocal remained close on phone; final lift translated without harshness.", noClipping: true, masterBackedUp: true },
    rights: { contributors: "Owen Anthony — artist, songwriter, producer. Additional contributors documented in the private release record.", splitStatus: "One writer — confirmed", sampleStatus: "None used", generativeAudioStatus: "No generative audio used", agreementsSaved: true },
    identity: { artDirection: "A broken heart in snow: quiet, cinematic, cold negative space with one immediate emotional object.", artworkLocation: "/assets/releases/the-cold-is-lasting-longer.jpg", artistBio: "Owen Anthony makes patient electronic music built around atmosphere, emotional pacing, and the spaces between club energy and private reflection.", rightsConfirmed: true, thumbnailChecked: true },
    metadata: { officialTitle: "The Cold Is Lasting Longer", artistName: "Owen Anthony", version: "Original", genre: "Electronic / Afrobeat", language: "English", contentRating: "Clean", songwriterCredits: "Owen Anthony", producerCredits: "Owen Anthony — production and performance", copyrightLines: "2026 ownership information confirmed in the private release record", metadataChecked: true },
    distributor: { budgetModel: "Annual subscription", releaseFrequency: "2–4 releases this year", priorities: "Simple delivery, reusable pre-save link, frequent independent releases, and control of the artist account.", selectedDistributor: "DistroKid", termsChecked: true },
    upload: { submissionDate: "2026-07-20", releaseDate: "2026-08-10", storePlan: "Spotify, Apple Music, YouTube Music, TikTok, and other supported services.", distributorUrl: "https://distrokid.com/hyperfollow/owenanthony/the-cold-is-lasting-longer", audioUploaded: true, artUploaded: true, submissionChecked: true },
    campaign: { releasePitch: "A slow-building electronic and Afrobeat signal for late-night listening, warm-up rooms, and emotionally paced DJ sets. The track stays with the quiet aftermath of a relationship instead of rushing toward closure.", coreAudience: "Late-night electronic listeners, emotionally led selectors, independent radio, and existing Owen Anthony supporters.", campaignMoment: "Private HALO preview followed by fan, DJ, radio, and press release rooms.", assets: ["Fan smart link", "Short-form video", "DJ pack", "Radio pack", "Press story", "Private preview", "Email or direct message"] },
    releaseDay: { liveUrl: "https://distrokid.com/hyperfollow/owenanthony/the-cold-is-lasting-longer", releaseMessage: "This song came from the part of an ending that keeps living after the conversation is over. The Cold Is Lasting Longer is out now.", linksChecked: true, profilesChecked: true, supportersThanked: true },
    afterRelease: { firstLesson: "Patient records need patient campaigns. The atmosphere is the story, not something to explain away.", weekOneAction: "Follow up with DJs and radio contacts who opened the release room; thank early listeners personally.", dayThirtyGoal: "Review meaningful responses, publish one behind-the-song piece, and document which audience lane responded most strongly.", nextSong: "Carry the strongest audience lessons into the next release without copying this campaign.", releaseRecorded: true }
  }
});

const elements = Object.fromEntries([
  "accountButton", "loadSampleButton", "heroFloorPlan", "workspace", "projectSelect", "newProjectButton", "saveButton",
  "roomNavigation", "roomPanel", "railPercent", "railProgressBar", "readinessCircle", "readinessScore",
  "briefTitle", "briefCopy", "briefArtist", "briefTrack", "briefDate", "briefDistributor", "nextMove",
  "releasePassport", "passportIdentity", "passportScore", "passportNext", "passportReason", "passportStages",
  "supportButton", "saveStatus", "projectDialog", "projectForm", "newProjectName", "newArtistName",
  "newTrackTitle", "sampleProjectButton", "identityDialog", "identityForm", "identityTitle", "identityIntro",
  "identityNameField", "identityName", "identityEmail", "identityPassword", "identityMessage", "identitySubmit",
  "supportDialog"
].map(id => [id, document.getElementById(id)]));

const state = {
  identity: null,
  user: null,
  authenticated: false,
  projects: [],
  current: emptyProject(),
  authMode: "signup",
  pendingSave: false,
  saveTimer: null,
  dirty: false
};

const passportStages = [
  { key: "artist", index: "01", label: "Artist room", note: "Give the release one permanent public home.", rooms: [7, 8] },
  { key: "campaign", index: "02", label: "Fan campaign", note: "Turn the release story into a reason to participate.", rooms: [11] },
  { key: "radio", index: "03", label: "Radio", note: "Carry the approved audio, rights, and metadata into review.", rooms: [5, 6, 8] },
  { key: "outreach", index: "04", label: "Outreach", note: "Prepare evidence-led introductions after the release room exists.", rooms: [8, 11] },
  { key: "team", index: "05", label: "Weekly team", note: "Return to one brief for the next three useful moves.", rooms: [7, 8] }
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function renderFloorPlan() {
  elements.heroFloorPlan.innerHTML = rooms.map((room, index) => `
    <button class="blueprint-room" type="button" data-floor-room="${index + 1}">
      <span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(room.name)}</strong><i></i>
    </button>`).join("");
}

function renderNavigation() {
  elements.roomNavigation.innerHTML = rooms.map((room, index) => {
    const number = index + 1;
    const complete = state.current.completedRooms.includes(number);
    return `<li><button class="room-nav-button${complete ? " is-complete" : ""}" type="button" data-room="${number}" ${state.current.currentRoom === number ? 'aria-current="step"' : ""} aria-label="Room ${number}: ${escapeHtml(room.name)}${complete ? ", complete" : ""}">
      <span class="room-nav-number">${String(number).padStart(2, "0")}</span><span class="room-nav-label">${escapeHtml(room.short)}</span><i class="room-nav-status" aria-hidden="true"></i>
    </button></li>`;
  }).join("");
}

function fieldValue(roomKey, fieldId) {
  return state.current.roomData?.[roomKey]?.[fieldId] ?? (rooms.find(room => room.key === roomKey)?.fields.find(field => field.id === fieldId)?.type === "checkgroup" ? [] : "");
}

function renderField(room, field) {
  const value = fieldValue(room.key, field.id);
  const required = field.required ? " data-required=\"true\"" : "";
  const wide = field.wide || field.type === "checkgroup" ? " is-wide" : "";
  const help = field.help ? `<p class="field-help">${escapeHtml(field.help)}</p>` : "";
  const label = `${escapeHtml(field.label)}${field.required ? "" : " <small>optional</small>"}`;

  if (field.type === "textarea") {
    return `<label class="room-field${wide}"><span>${label}</span><textarea data-field="${field.id}"${required} placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value)}</textarea>${help}</label>`;
  }
  if (field.type === "select") {
    return `<label class="room-field${wide}"><span>${label}</span><select data-field="${field.id}"${required}>${field.options.map(option => `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(option || "Choose one")}</option>`).join("")}</select>${help}</label>`;
  }
  if (field.type === "checkbox") {
    return `<label class="check-field${wide}"><input type="checkbox" data-field="${field.id}"${required} ${value === true ? "checked" : ""}><span>${escapeHtml(field.label)}</span></label>`;
  }
  if (field.type === "checkgroup") {
    return `<fieldset class="check-group${wide}" data-field="${field.id}"${required}><legend>${label}</legend><div class="check-grid">${field.options.map(option => `<label class="check-field"><input type="checkbox" value="${escapeHtml(option)}" ${Array.isArray(value) && value.includes(option) ? "checked" : ""}><span>${escapeHtml(option)}</span></label>`).join("")}</div></fieldset>`;
  }
  return `<label class="room-field${wide}"><span>${label}</span><input type="${field.type || "text"}" data-field="${field.id}"${required} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || "")}">${help}</label>`;
}

function sunoBrief() {
  const idea = state.current.roomData.idea || {};
  const writing = state.current.roomData.writing || {};
  const production = state.current.roomData.production || {};
  const parts = [
    idea.concept && `Song purpose: ${idea.concept}`,
    idea.feeling && `Listener feeling: ${idea.feeling}`,
    writing.hook && `Hook or central idea: ${writing.hook}`,
    writing.structure && `Structure: ${writing.structure}`,
    production.references && `Reference qualities, without copying: ${production.references}`,
    production.arrangement && `Arrangement journey: ${production.arrangement}`
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : "Complete the Idea and Writing rooms first, then return here for a stronger creation brief.";
}

function renderCreationAssist(room) {
  if (room.key !== "recording") return "";
  return `<aside class="creation-assist" aria-labelledby="creationAssistTitle">
    <div class="creation-assist-index" aria-hidden="true">AI / 01</div>
    <div class="creation-assist-copy">
      <p class="kicker">Optional creation tool</p>
      <h4 id="creationAssistTitle">Use Suno when it helps the artist—not when it replaces their voice.</h4>
      <p>Turn the decisions already made in Release House into a starting brief. Suno opens as an independent service; HALO does not send project data automatically.</p>
      <div class="creation-brief"><span>Your portable brief</span><pre>${escapeHtml(sunoBrief())}</pre></div>
      <p class="creation-assist-status" data-creation-status role="status">Copy the brief, explore versions, then record what you kept and changed.</p>
    </div>
    <div class="creation-assist-actions">
      <button type="button" data-copy-creation-brief>Copy brief</button>
      <a href="https://suno.com/create" target="_blank" rel="noopener noreferrer">Open Suno <span aria-hidden="true">↗</span></a>
      <small>Check the terms attached to your Suno plan before commercial release. HALO never guarantees ownership of generated material.</small>
    </div>
  </aside>`;
}

function renderRoom() {
  const roomNumber = state.current.currentRoom;
  const room = rooms[roomNumber - 1];
  const complete = state.current.completedRooms.includes(roomNumber);
  elements.roomPanel.innerHTML = `<div class="room-panel-inner">
    <header class="room-heading">
      <div><p class="kicker">Room ${String(roomNumber).padStart(2, "0")} / ${escapeHtml(room.name)}</p><h3>${escapeHtml(room.title)}</h3><p>${escapeHtml(room.intro)}</p></div>
      <div class="room-stamp">${complete ? "READY" : "OPEN"}</div>
    </header>
    <div class="lesson-strip">
      <div class="lesson-card"><span>Learn it</span><strong>What matters here</strong><p>${escapeHtml(room.learn)}</p></div>
      <div class="lesson-card"><span>See it</span><strong>A concrete example</strong><p>${escapeHtml(room.example)}</p></div>
    </div>
    ${renderCreationAssist(room)}
    <form class="room-form" id="activeRoomForm" novalidate>
      <div class="room-form-grid">${room.fields.map(field => renderField(room, field)).join("")}</div>
      <p class="room-validation" id="roomValidation" role="status"></p>
      <div class="room-footer-actions">
        <button type="button" data-previous-room ${roomNumber === 1 ? "disabled" : ""}>Previous room</button>
        <button class="complete-room${complete ? " is-complete" : ""}" type="button" data-complete-room>${complete ? "Room complete — review" : "Complete this room"}</button>
        <button type="button" data-next-room ${roomNumber === rooms.length ? "disabled" : ""}>Next room</button>
      </div>
    </form>
  </div>`;
}

function renderProjectPicker() {
  const choices = [...state.projects];
  if (!choices.some(project => project.id === state.current.id)) choices.unshift(state.current);
  elements.projectSelect.innerHTML = choices.map(project => `<option value="${escapeHtml(project.id)}" ${project.id === state.current.id ? "selected" : ""}>${escapeHtml(project.projectName)}</option>`).join("");
}

function renderBrief() {
  const completed = state.current.completedRooms.length;
  const percent = Math.round((completed / rooms.length) * 100);
  const room = rooms[state.current.currentRoom - 1];
  const metadata = state.current.roomData.metadata || {};
  const distributor = state.current.roomData.distributor || {};
  const upload = state.current.roomData.upload || {};
  const idea = state.current.roomData.idea || {};
  elements.railPercent.textContent = `${percent}%`;
  elements.railProgressBar.style.transform = `scaleX(${percent / 100})`;
  elements.readinessScore.textContent = percent;
  elements.readinessCircle.style.strokeDashoffset = String(327 - (327 * percent / 100));
  elements.briefTitle.textContent = completed === rooms.length ? "The whole house is ready." : room.title;
  elements.briefCopy.textContent = completed === rooms.length ? "Review the live details, keep the final record safe, and carry what you learned into the next song." : room.intro;
  elements.briefArtist.textContent = metadata.artistName || state.current.artistName || "Not set";
  elements.briefTrack.textContent = metadata.officialTitle || state.current.trackTitle || idea.workingTitle || "Working title";
  elements.briefDate.textContent = formatDate(upload.releaseDate || state.current.targetReleaseDate) || "No date yet";
  elements.briefDistributor.textContent = distributor.selectedDistributor || "Not chosen";
  const firstIncomplete = rooms.findIndex((_, index) => !state.current.completedRooms.includes(index + 1));
  elements.nextMove.textContent = firstIncomplete === -1 ? "Schedule the next honest follow-up." : rooms[firstIncomplete].next;
}

function releaseIdentity(project = state.current) {
  const metadata = project.roomData?.metadata || {};
  const idea = project.roomData?.idea || {};
  return {
    artist: metadata.artistName || project.artistName || "Unnamed artist",
    track: metadata.officialTitle || project.trackTitle || idea.workingTitle || "Untitled release"
  };
}

function projectUrl(path, extra = {}) {
  const url = new URL(path, window.location.origin);
  if (!['guest', 'sample'].includes(state.current.id)) url.searchParams.set("releaseProject", state.current.id);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}${url.hash}`;
}

function stageState(stage) {
  const connections = state.current.connections || {};
  const identity = releaseIdentity();
  const ready = stage.rooms.every(room => state.current.completedRooms.includes(room));
  const artistPage = connections.artistPage;
  const catalogRelease = connections.catalogRelease;
  const fanCampaign = connections.fanCampaign;
  const radioTrack = connections.radioTrack;

  if (stage.key === "artist") return {
    href: artistPage
      ? projectUrl(`/artists/${artistPage.slug}`)
      : projectUrl("/artists/", { artist: identity.artist, release: identity.track }),
    status: artistPage ? (artistPage.status === "published" ? "Connected" : "Draft linked") : (ready ? "Ready to build" : "Prepare rooms 07–08"),
    connected: Boolean(artistPage), ready
  };
  if (stage.key === "campaign") return {
    href: fanCampaign ? projectUrl("/campaign-studio/", { campaign: fanCampaign.slug }) : projectUrl("/campaign-studio/"),
    status: fanCampaign ? (fanCampaign.status === "published" ? "Live campaign" : "Draft linked") : (ready ? "Ready to shape" : "Complete room 11"),
    connected: Boolean(fanCampaign), ready
  };
  if (stage.key === "radio") return {
    href: projectUrl("/radio/", { releaseId: catalogRelease?.id || artistPage?.releaseId || "" }),
    status: radioTrack ? `Radio · ${radioTrack.status}` : (ready ? "Ready to submit" : "Mix, rights + metadata"),
    connected: Boolean(radioTrack), ready
  };
  if (stage.key === "outreach") return {
    href: catalogRelease ? projectUrl("/outreach.html", { releaseId: catalogRelease.id }) : projectUrl("/artists/", { artist: identity.artist, release: identity.track }),
    status: catalogRelease ? (catalogRelease.status === "published" ? "Release linked" : "Publish release room") : (ready ? "Build release room first" : "Prepare metadata + campaign"),
    connected: catalogRelease?.status === "published", ready
  };
  return {
    href: artistPage ? projectUrl("/artist-team.html", { slug: artistPage.slug }) : projectUrl("/artists/", { artist: identity.artist, release: identity.track }),
    status: artistPage ? "Team ready" : (ready ? "Create artist room" : "Prepare artist identity"),
    connected: Boolean(artistPage), ready
  };
}

function renderPassport() {
  const identity = releaseIdentity();
  const completed = state.current.completedRooms.length;
  const percent = Math.round((completed / rooms.length) * 100);
  const states = passportStages.map(stage => ({ ...stage, ...stageState(stage) }));
  const nextStage = states.find(stage => !stage.connected && stage.ready) || states.find(stage => !stage.connected) || states[states.length - 1];
  elements.passportIdentity.textContent = `${identity.artist} — ${identity.track}`;
  elements.passportScore.textContent = `${percent}%`;
  elements.passportNext.textContent = nextStage.connected ? "Review the weekly team brief." : `${nextStage.label}: ${nextStage.status}`;
  elements.passportReason.textContent = nextStage.note;
  elements.passportStages.innerHTML = states.map(stage => `
    <a class="passport-stage${stage.connected ? " is-connected" : ""}${stage.ready ? " is-ready" : ""}" href="${escapeHtml(stage.href)}" data-passport-stage="${stage.key}" data-stat-event="release_next_action_opened" data-stat-target="${stage.key}">
      <span class="passport-stage-index">${stage.index}</span>
      <span class="passport-stage-copy"><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.note)}</small></span>
      <span class="passport-stage-state">${escapeHtml(stage.status)}</span>
      <i aria-hidden="true">↗</i>
    </a>`).join("");
}

function renderAll() {
  renderProjectPicker();
  renderNavigation();
  renderRoom();
  renderBrief();
  renderPassport();
  document.querySelector(".workspace")?.removeAttribute("data-loading");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function setRoom(roomNumber, scroll = false) {
  state.current.currentRoom = Math.max(1, Math.min(rooms.length, Number(roomNumber) || 1));
  renderNavigation();
  renderRoom();
  renderBrief();
  renderPassport();
  if (scroll) elements.roomPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  markDirty();
}

function updateCoreProjectFields(roomKey, fieldId, value) {
  if (roomKey === "idea" && fieldId === "workingTitle" && !state.current.trackTitle) state.current.trackTitle = value;
  if (roomKey === "metadata" && fieldId === "officialTitle") state.current.trackTitle = value;
  if (roomKey === "metadata" && fieldId === "artistName") state.current.artistName = value;
  if (roomKey === "upload" && fieldId === "releaseDate") state.current.targetReleaseDate = value;
}

function handleRoomInput(event) {
  const room = rooms[state.current.currentRoom - 1];
  state.current.roomData[room.key] ||= {};
  const group = event.target.closest("[data-field]");
  if (!group) return;
  const fieldId = group.dataset.field;
  let value;
  if (group.matches("fieldset")) value = [...group.querySelectorAll("input:checked")].map(input => input.value);
  else if (event.target.type === "checkbox") value = event.target.checked;
  else value = event.target.value;
  state.current.roomData[room.key][fieldId] = value;
  updateCoreProjectFields(room.key, fieldId, value);
  renderBrief();
  renderPassport();
  markDirty();
}

function roomIsValid(showErrors = false) {
  const form = document.getElementById("activeRoomForm");
  const missing = [];
  form.querySelectorAll("[data-required=\"true\"]").forEach(field => {
    let valid;
    if (field.matches("fieldset")) valid = field.querySelector("input:checked");
    else if (field.type === "checkbox") valid = field.checked;
    else valid = field.value.trim().length > 0;
    field.closest(".room-field, .check-field, .check-group")?.classList.toggle("has-error", !valid);
    if (!valid) missing.push(field);
  });
  if (showErrors) {
    const message = document.getElementById("roomValidation");
    message.textContent = missing.length ? `Finish ${missing.length} required ${missing.length === 1 ? "item" : "items"} before marking this room complete.` : "This room is ready.";
    missing[0]?.focus?.();
  }
  return missing.length === 0;
}

function completeCurrentRoom() {
  const roomNumber = state.current.currentRoom;
  const alreadyComplete = state.current.completedRooms.includes(roomNumber);
  if (alreadyComplete) {
    setRoom(Math.min(rooms.length, roomNumber + 1), false);
    return;
  }
  if (!roomIsValid(true)) return;
  state.current.completedRooms = [...state.current.completedRooms, roomNumber].sort((left, right) => left - right);
  window.haloStats?.track("release_room_completed", { position: roomNumber, stage: rooms[roomNumber - 1].key });
  if (state.current.completedRooms.length === rooms.length) state.current.status = "released";
  state.dirty = true;
  if (roomNumber < rooms.length) state.current.currentRoom = roomNumber + 1;
  renderAll();
  scheduleSave();
}

function markDirty() {
  state.dirty = true;
  elements.saveStatus.textContent = state.authenticated && !["guest", "sample"].includes(state.current.id)
    ? "Changes are waiting to save."
    : "This draft is temporary until you join or sign in and save it.";
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  if (!state.authenticated || ["guest", "sample"].includes(state.current.id)) return;
  state.saveTimer = setTimeout(() => saveCurrentProject(true), 1100);
}

async function apiAction(payload) {
  const response = await fetch("/api/release-house", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "The Release House could not save that change.");
  return data;
}

function projectPayload(action) {
  return {
    action,
    ...(action === "save" ? { projectId: state.current.id } : {}),
    projectName: state.current.projectName,
    artistName: state.current.artistName,
    trackTitle: state.current.trackTitle,
    targetReleaseDate: state.current.targetReleaseDate,
    currentRoom: state.current.currentRoom,
    completedRooms: state.current.completedRooms,
    roomData: state.current.roomData,
    status: state.current.status
  };
}

async function saveCurrentProject(quiet = false) {
  if (!state.authenticated) {
    state.pendingSave = true;
    openIdentity("signup", "Join free to keep this release project and return to it later.");
    return;
  }
  if (["guest", "sample"].includes(state.current.id)) {
    elements.newProjectName.value = state.current.projectName.replace(" — completed example", "");
    elements.newArtistName.value = state.current.artistName;
    elements.newTrackTitle.value = state.current.trackTitle;
    elements.projectDialog.dataset.mode = "copy";
    elements.projectDialog.showModal();
    return;
  }
  try {
    elements.saveButton.disabled = true;
    if (!quiet) elements.saveStatus.textContent = "Saving your release house…";
    const connections = state.current.connections || {};
    const data = await apiAction(projectPayload("save"));
    data.project.connections = connections;
    state.current = data.project;
    const index = state.projects.findIndex(project => project.id === data.project.id);
    if (index >= 0) state.projects[index] = data.project;
    state.dirty = false;
    renderProjectPicker();
    elements.saveStatus.textContent = `Saved ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date())}.`;
    setReleaseContext(state.current);
  } catch (error) {
    elements.saveStatus.textContent = error.message;
  } finally {
    elements.saveButton.disabled = false;
  }
}

async function createProject({ useSample = false, blank = false } = {}) {
  if (!state.authenticated) {
    state.pendingSave = true;
    openIdentity("signup", "Join free to create and save a release project.");
    return;
  }
  const source = useSample ? sampleProject() : blank ? emptyProject() : structuredClone(state.current);
  source.projectName = elements.newProjectName.value.trim() || source.projectName;
  source.artistName = elements.newArtistName.value.trim() || source.artistName;
  source.trackTitle = elements.newTrackTitle.value.trim() || source.trackTitle;
  try {
    const data = await apiAction({ ...projectPayloadFrom(source), action: "create" });
    state.projects.unshift(data.project);
    state.current = data.project;
    state.dirty = false;
    elements.projectDialog.close();
    renderAll();
    setReleaseContext(state.current);
    window.haloStats?.track("release_project_created", { stage: "release_house" });
    elements.saveStatus.textContent = data.message;
  } catch (error) {
    elements.saveStatus.textContent = error.message;
  }
}

function projectPayloadFrom(project) {
  return {
    projectName: project.projectName,
    artistName: project.artistName,
    trackTitle: project.trackTitle,
    targetReleaseDate: project.targetReleaseDate,
    currentRoom: project.currentRoom,
    completedRooms: project.completedRooms,
    roomData: project.roomData
  };
}

async function loadProjects() {
  try {
    const response = await fetch("/api/release-house", { credentials: "same-origin" });
    const data = await response.json();
    state.authenticated = Boolean(data.authenticated);
    if (data.viewer?.name) state.user = { name: data.viewer.name };
    state.projects = data.projects || [];
    const requestedProject = new URL(window.location.href).searchParams.get("releaseProject") || sessionStorage.getItem("halo-release-project") || "";
    if (state.projects.length) state.current = state.projects.find(project => project.id === requestedProject) || state.projects[0];
    if (state.projects.length) {
      setReleaseContext(state.current);
      window.haloStats?.track("release_project_opened", { stage: "release_house" });
    }
    updateAccount();
    renderAll();
    elements.saveStatus.textContent = state.authenticated
      ? (state.projects.length ? "Your most recent release project is open." : "Start a project and your progress saves to your HALO membership.")
      : "This draft is temporary until you join or sign in and save it.";
  } catch {
    renderAll();
    elements.saveStatus.textContent = "The saved-project service is unavailable. You can still explore the full house.";
  }
}

function setReleaseContext(project) {
  if (!project || ["guest", "sample"].includes(project.id)) return;
  sessionStorage.setItem("halo-release-project", project.id);
  const url = new URL(window.location.href);
  url.searchParams.set("releaseProject", project.id);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function updateAccount() {
  const name = state.user?.name || state.user?.userMetadata?.full_name || state.user?.user_metadata?.full_name;
  elements.accountButton.textContent = state.authenticated ? `${name || "HALO member"} · Sign out` : "Join / sign in";
}

function openIdentity(mode = "signup", message = "") {
  state.authMode = mode;
  elements.identityMessage.textContent = message;
  elements.identityForm.reset();
  updateIdentityMode();
  elements.identityDialog.showModal();
}

function updateIdentityMode() {
  const signup = state.authMode === "signup";
  elements.identityNameField.hidden = !signup;
  elements.identityName.required = signup;
  elements.identityPassword.autocomplete = signup ? "new-password" : "current-password";
  elements.identityTitle.textContent = signup ? "Join HALO." : "Welcome back.";
  elements.identityIntro.textContent = signup ? "Create a free membership to save this release and return on any device." : "Sign in to reopen your saved release projects.";
  elements.identitySubmit.textContent = signup ? "Join and save" : "Sign in";
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.authMode === state.authMode)));
}

async function submitIdentity(event) {
  event.preventDefault();
  if (!state.identity) {
    elements.identityMessage.textContent = "Membership is still connecting. Try again in a moment.";
    return;
  }
  elements.identitySubmit.disabled = true;
  elements.identityMessage.textContent = "";
  try {
    let user;
    if (state.authMode === "signup") {
      user = await state.identity.signup(elements.identityEmail.value.trim(), elements.identityPassword.value, { full_name: elements.identityName.value.trim() });
      if (!user?.emailVerified) {
        elements.identityMessage.textContent = "Check your email to confirm your membership, then return to this page to save.";
        return;
      }
    } else {
      user = await state.identity.login(elements.identityEmail.value.trim(), elements.identityPassword.value);
    }
    state.user = user;
    state.authenticated = true;
    elements.identityDialog.close();
    updateAccount();
    const draft = state.current;
    await loadProjects();
    if (state.pendingSave) {
      state.pendingSave = false;
      if (!state.projects.length || !["guest", "sample"].includes(draft.id)) state.current = draft;
      else state.current = draft;
      renderAll();
      await saveCurrentProject();
    }
  } catch (error) {
    elements.identityMessage.textContent = error.message || "Membership could not be completed.";
  } finally {
    elements.identitySubmit.disabled = false;
  }
}

function selectProject(id) {
  const project = state.projects.find(candidate => candidate.id === id);
  if (!project) return;
  state.current = project;
  setReleaseContext(project);
  renderAll();
}

function tourSample() {
  state.current = sampleProject();
  state.current.currentRoom = 1;
  renderAll();
  elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.saveStatus.textContent = "You are touring a completed example. Choose Save progress to make your own copy.";
}

function bindEvents() {
  elements.heroFloorPlan.addEventListener("click", event => {
    const button = event.target.closest("[data-floor-room]");
    if (!button) return;
    setRoom(button.dataset.floorRoom);
    elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.roomNavigation.addEventListener("click", event => {
    const button = event.target.closest("[data-room]");
    if (button) setRoom(button.dataset.room, true);
  });
  elements.roomPanel.addEventListener("input", handleRoomInput);
  elements.roomPanel.addEventListener("change", handleRoomInput);
  elements.roomPanel.addEventListener("click", async event => {
    if (event.target.closest("[data-copy-creation-brief]")) {
      const status = elements.roomPanel.querySelector("[data-creation-status]");
      try {
        await navigator.clipboard.writeText(sunoBrief());
        if (status) status.textContent = "Brief copied. Your project stays in HALO until you choose to paste it elsewhere.";
      } catch {
        if (status) status.textContent = "Copy was blocked by the browser. Select the brief text and copy it manually.";
      }
    }
    if (event.target.closest("[data-complete-room]")) completeCurrentRoom();
    if (event.target.closest("[data-previous-room]")) setRoom(state.current.currentRoom - 1, true);
    if (event.target.closest("[data-next-room]")) setRoom(state.current.currentRoom + 1, true);
  });
  elements.loadSampleButton.addEventListener("click", tourSample);
  elements.projectSelect.addEventListener("change", event => selectProject(event.target.value));
  elements.newProjectButton.addEventListener("click", () => {
    if (!state.authenticated) return openIdentity("signup", "Join free to open and save a release project.");
    elements.projectForm.reset();
    elements.projectDialog.dataset.mode = "blank";
    elements.projectDialog.showModal();
  });
  elements.saveButton.addEventListener("click", () => saveCurrentProject());
  elements.projectForm.addEventListener("submit", event => {
    event.preventDefault();
    createProject({ blank: elements.projectDialog.dataset.mode === "blank" });
  });
  elements.sampleProjectButton.addEventListener("click", () => {
    const sample = sampleProject();
    elements.newProjectName.value = "The Cold Is Lasting Longer — my practice copy";
    elements.newArtistName.value = sample.artistName;
    elements.newTrackTitle.value = sample.trackTitle;
    createProject({ useSample: true });
  });
  elements.accountButton.addEventListener("click", async () => {
    if (state.authenticated && state.identity) {
      await state.identity.logout();
      state.user = null;
      state.authenticated = false;
      state.projects = [];
      state.current = emptyProject();
      updateAccount();
      renderAll();
      elements.saveStatus.textContent = "Signed out. This new draft is temporary until you sign in again.";
    } else openIdentity("signup");
  });
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => { state.authMode = button.dataset.authMode; updateIdentityMode(); }));
  elements.identityForm.addEventListener("submit", submitIdentity);
  elements.supportButton.addEventListener("click", () => elements.supportDialog.showModal());
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); }));
}

window.addEventListener("halo-identity-ready", event => {
  state.identity = event.detail;
  state.identity.getUser().then(user => {
    state.user = user;
    if (user) state.authenticated = true;
    updateAccount();
  }).catch(() => null);
}, { once: true });

renderFloorPlan();
bindEvents();
loadProjects();
