import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { PUBLIC_ROUTE_REGISTRY } from "../lib/route-registry.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [script, home] = await Promise.all([read("onboarding.js"), read("halo.html")]);
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), values };
};
function load(globals = {}) {
  const context = vm.createContext({ URL, URLSearchParams, ...globals });
  vm.runInContext(script, context);
  return context.HaloOnboarding;
}
const quiz = load();
assert.equal(quiz.questions.length, 3);
assert.equal(quiz.score([2, 1, 1]).path, "coop", "deep libraries should favor Catalog Co-Op");
for (const [path, answers] of [
  ["solo", [0, 0, 0]], ["coop", [1, 1, 1]],
  ["collab", [3, 2, 2]], ["testing", [0, 3, 3]]
]) assert.equal(quiz.score(answers).path, path);

// Exhaust all 64 combinations, including three-way ties.
for (let catalog = 0; catalog < 4; catalog++) {
  for (let goal = 0; goal < 4; goal++) {
    for (let support = 0; support < 4; support++) {
      const answers = [catalog, goal, support];
      const votes = answers.map((answer, index) => quiz.questions[index].options[answer].path);
      const result = quiz.score(answers);
      const max = Math.max(...Object.values(result.counts));
      assert.equal(result.counts[result.path], max);
      assert.equal(Object.values(result.counts).reduce((sum, count) => sum + count, 0), 3);
      const tied = Object.keys(result.counts).filter(path => result.counts[path] === max);
      if (tied.length > 1) {
        assert.equal(result.path, votes[1], "today's primary goal breaks every possible tie");
        assert.match(result.explanation, /primary goal breaks the tie/);
      }
      assert.equal(result.path, quiz.score(answers).path, "scoring is deterministic");
    }
  }
}
for (const answers of [[], [0, 1], [0, 1, 4], [-1, 1, 0], ["0", 1, 0], new Array(3)]) {
  assert.throws(() => quiz.score(answers), /Answer all three/);
}
let state = quiz.initialState();
assert.equal(quiz.transition(state, { type: "next" }), state, "unanswered steps cannot advance");
assert.equal(quiz.transition(state, { type: "select", answer: -1 }), state);
for (const answer of [0, 3, 3]) {
  state = quiz.transition(state, { type: "select", answer });
  state = quiz.transition(state, { type: "next" });
}
assert.equal(state.step, 3);
assert.equal(quiz.score(state.answers).path, "testing");
state = quiz.transition(state, { type: "back" });
state = quiz.transition(state, { type: "back" });
assert.equal(state.answers[1], 3, "Back retains the previous selection");
state = quiz.transition(state, { type: "select", answer: 0 });
assert.equal(state.answers.length, 3, "editing an answer replaces it rather than appending a vote");
assert.equal(quiz.score(state.answers).path, "solo");
state = quiz.transition(state, { type: "restart" });
assert.equal(state.step, 0);
assert.equal(state.answers.length, 0);
assert.equal(quiz.transition(state, { type: "back" }).step, 0);

const localStorage = storage();
const sessionStorage = storage();
const firstVisit = load({ localStorage, sessionStorage });
assert.equal(firstVisit.isDismissed(), false);
firstVisit.dismiss("skipped");
assert.equal(load({ localStorage, sessionStorage }).isDismissed(), true, "skip survives a reload");
firstVisit.dismiss("completed");
assert.equal(load({ localStorage, sessionStorage }).isDismissed(), true);
assert.equal(localStorage.values.size, 1);
assert.equal(localStorage.getItem("halo-onboarding-v1"), "completed", "no answers or identity are stored");
const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
const blockedVisit = load({ localStorage: blocked, sessionStorage: blocked });
assert.equal(blockedVisit.isDismissed(), false);
blockedVisit.dismiss("skipped");
assert.equal(blockedVisit.isDismissed(), true, "storage failures still allow dismissal for this visit");
const sessionFallback = storage();
load({ localStorage: blocked, sessionStorage: sessionFallback }).dismiss("completed");
assert.equal(load({ localStorage: blocked, sessionStorage: sessionFallback }).isDismissed(), true);
assert.equal(load({ localStorage: { getItem: () => "corrupt" } }).isDismissed(), false);

for (const [url, expected] of [
  ["/halo", true], ["/halo.html", true], ["/", true], ["/halo?room=selectors", false],
  ["/halo#clubhouse", false], ["/radio-dj", false], ["/release-house/?mode=solo", false]
]) assert.equal(quiz.isHome(new URL(url, "https://halo.test")), expected);

const registered = new Set(PUBLIC_ROUTE_REGISTRY.map(({ route }) => route));
const events = [];
const pushes = [];
const fakeWindow = {
  location: new URL("https://halo.test/halo"),
  history: { pushState: (...args) => pushes.push(args) },
  dispatchEvent: event => events.push(event.type),
  PopStateEvent: class { constructor(type) { this.type = type; } }
};
for (const [path, { route }] of Object.entries(quiz.paths)) {
  const destination = new URL(route, "https://halo.test");
  assert.ok(registered.has(destination.pathname));
  const entry = PUBLIC_ROUTE_REGISTRY.find(({ route }) => route === destination.pathname);
  await read(entry.file);
  assert.equal(destination.searchParams.get("mode"), path);
  assert.equal(quiz.workspaceForLocation(destination), path);
  assert.equal(quiz.navigate(path, fakeWindow), true);
  assert.equal(pushes.at(-1)[2], route);
  assert.equal(events.at(-1), "popstate");
  assert.match(home, new RegExp(`href="${route.replaceAll("?", "\\?")}" data-path-mode="${path}"`));
}
assert.equal(quiz.workspaceForLocation(new URL("https://halo.test/halo")), null);
for (const path of ["unknown", "__proto__", "https://outside.test"]) {
  assert.equal(quiz.navigate(path, fakeWindow), false, "routing only accepts supported workspace IDs");
}
for (const route of ["/halo", "/halo#clubhouse", "/radio-dj", "/halo-tv", "/song-catalog/?mode=coop"]) {
  assert.equal(quiz.navigateApp(route, fakeWindow), true);
  assert.equal(pushes.at(-1)[2], route);
}
for (const route of ["https://outside.test/halo", "javascript:alert(1)", "/missing"]) {
  assert.equal(quiz.navigateApp(route, fakeWindow), false, "app routing cannot escape the origin or create dead links");
}
let frameClick;
quiz.connectWorkspace({ contentDocument: {
  baseURI: "https://halo.test/release-house/?mode=solo",
  addEventListener: (type, callback) => { assert.equal(type, "click"); frameClick = callback; }
} }, fakeWindow);
for (const [href, expectedPush] of [
  ["/halo", true], ["/halo?room=selectors", true], ["/radio-dj", true],
  ["/music/?mode=testing", true], ["/support/", false]
]) {
  let prevented = false;
  const count = pushes.length;
  const link = {
    href, target: "", hasAttribute: () => false, getAttribute: () => href
  };
  frameClick({
    button: 0, target: { closest: () => link },
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, expectedPush);
  assert.equal(pushes.length, count + Number(expectedPush));
  if (!expectedPush) assert.equal(link.target, "_top", "other satellites use native top-level links, not nested homepages");
}
for (const overrides of [{ ctrlKey: true }, { button: 1 }, { defaultPrevented: true }]) {
  const count = pushes.length;
  frameClick({ button: 0, ...overrides, target: { closest: () => ({ href: "/halo" }) } });
  assert.equal(pushes.length, count);
}
assert.doesNotThrow(() => quiz.connectWorkspace({ contentDocument: null }, fakeWindow));

// Exercise the actual dashboard handlers using the repository's VM contract convention.
function handler(name, globals) {
  const body = home.match(new RegExp(`const ${name} = [^\\n]*?=> \\{([\\s\\S]*?)\\n          \\};`))?.[1];
  assert.ok(body, `${name} is wired into the dashboard`);
  return (args = {}) => vm.runInNewContext(`(() => {${body}})()`, { ...globals, ...args });
}
let opened = null;
let prevented = false;
const select = handler("selectPathWorkspace", { openPathWorkspace: path => { opened = path; } });
for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
  opened = null;
  prevented = false;
  select({ event: {
    button: 0, ...modifiers,
    target: { closest: () => ({ dataset: { pathMode: "solo" } }) },
    preventDefault() { prevented = true; }
  } });
  assert.equal(prevented, Object.keys(modifiers).length === 0);
  assert.equal(opened, prevented ? "solo" : null, "modified links retain native open-in-new-tab behavior");
}
let visible = true;
let focusCount = 0;
let status = null;
handler("closeOnboarding", {
  window: { HaloOnboarding: { dismiss: value => { status = value; } }, requestAnimationFrame: fn => fn() },
  setShowOnboarding: value => { visible = value; },
  pathQuizButton: { current: { focus: () => focusCount++ } }
})();
assert.equal(visible, false);
assert.equal(status, "skipped");
assert.equal(focusCount, 1, "skip/cancel restores focus to the revisit button");
let routed = null;
let explanation = null;
handler("openPathWorkspace", {
  window: { HaloOnboarding: { dismiss: value => { status = value; }, navigate: path => { routed = path; } } },
  setShowOnboarding: value => { visible = value; },
  setPathExplanation: value => { explanation = value; }
})({ path: "testing", explanation: "Two answers match." });
assert.equal(status, "completed");
assert.equal(visible, false);
assert.equal(routed, "testing");
assert.equal(explanation, "Two answers match.");

const wizard = home.match(/const OnboardingWizard = [\s\S]*?\n        const DEFAULT_FEATURED_RELEASE/)?.[0];
assert.ok(wizard);
const nextBody = wizard.match(/const next = event => \{([\s\S]*?)\n          \};/)?.[1];
assert.ok(nextBody);
for (const [step, answers, expected] of [[0, [], "blocked"], [0, [0], "next"], [1, [0, 3], "next"], [2, [0, 3, 3], "testing"]]) {
  let action = "blocked";
  vm.runInNewContext(`(() => {${nextBody}})()`, {
    event: { preventDefault() {} }, state: { step, answers }, selected: answers[step], quiz,
    act: value => { action = value.type; },
    onComplete: value => { action = value.path; }
  });
  assert.equal(action, expected, "the actual submit handler only completes after three answers");
}
for (const pattern of [
  /<form onSubmit=\{next\}/, /event\.key === 'Escape'/, /<fieldset>/, /<legend/,
  /type="radio"/, /checked=\{selected === index\}/, /disabled=\{selected === undefined\}/,
  /disabled=\{state\.step === 0\}/, /aria-live="polite"/, /<progress/,
  /ref=\{heading\} tabIndex="-1"/, /heading\.current\?\.focus\(\)/,
  /type: 'restart'/, /type: 'back'/, /onComplete\(quiz\.score\(state\.answers\)\)/
]) assert.match(wizard, pattern);
assert.match(home, /onClick=\{\(\) => setShowOnboarding\(true\)\}/, "quiz can always be revisited");
assert.match(home, /addEventListener\('popstate', syncWorkspace\)/, "browser Back/Forward restores the outlet");
assert.match(home, /addEventListener\('popstate', openCompanionRoute\)/, "history restores existing console routes too");
const syncBody = home.match(/const syncWorkspace = \(\) => \{([\s\S]*?)\n            \};/)?.[1];
for (const [route, expected] of [["/halo", null], ["/music/?mode=testing", "testing"], ["/radio-dj", null]]) {
  let workspace;
  let view;
  vm.runInNewContext(`(() => {${syncBody}})()`, {
    window: { HaloOnboarding: quiz, location: new URL(route, "https://halo.test") },
    setPathWorkspace: value => { workspace = value; }, setPathExplanation() {},
    setShowOnboarding: value => assert.equal(value, false), setViewMode: value => { view = value; }
  });
  assert.equal(workspace, expected);
  assert.equal(view, "landing", "home history leaves the workspace; companion routes can then select console");
}
assert.match(home, /workspaceHeading\.current\?\.focus\(\)/);
assert.match(home, /<iframe key=\{pathWorkspace\}[\s\S]*?title=\{`\$\{window\.HaloOnboarding\.paths\[pathWorkspace\]\.title\} workspace`\}/);
assert.doesNotMatch(script, /location\.(?:href|assign|replace)\s*[=(]|fetch\(/, "onboarding neither reloads the app nor transmits answers");
console.log("Onboarding contracts passed: scoring, ties, flow, persistence, supported routing, focus and accessibility wiring.");
