import assert from "node:assert/strict";
import fs from "node:fs";
import { PUBLIC_ROUTE_REGISTRY } from "../lib/route-registry.js";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("pricing/index.html");
const css = read("pricing/pricing.css");
const home = read("halo.html");
const cards = [...html.matchAll(/<article class="plan\b[^"]*"[\s\S]*?<\/article>/g)].map(match => match[0]);
const tiers = [
  ["Free / Entry", "$0"],
  ["Creator", "$15–$49"],
  ["Pro Creator / Label Starter", "$99–$299"],
  ["Halo Shield Plus", "$299–$1,500"],
  ["Enterprise / White-label", "$2,500–$25,000+"]
];
assert.equal(cards.length, tiers.length, "pricing must include five distinct tiers");
for (const [index, [title, price]] of tiers.entries()) {
  assert.ok(cards[index].includes(`>${title}</h3>`), `${title} needs a heading`);
  assert.ok(cards[index].includes(price), `${title} needs its suggested price`);
  assert.match(cards[index], /\/ month/);
  assert.equal([...cards[index].matchAll(/<li>/g)].length, 3, `${title} needs concise benefits`);
  assert.match(cards[index], index === 0 ? /href="\/music\/"/ : /href="\/support\/#send"/);
  const titleId = cards[index].match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(titleId && cards[index].includes(`id="${titleId}"`), "each plan must have an accessible name");
}
assert.match(html, /Halo Shield is the trust layer for Halo Music/);
assert.match(html, /Proposed plans, not live subscriptions/);
assert.match(html, /suggested USD monthly placeholders/);
assert.match(html, /Paid benefits below are proposed/);
assert.match(html, /No payment is collected/);
assert.match(html, /Public protection outcomes remain visible without a paid plan/);
assert.match(html, /No system can guarantee complete protection/);
assert.match(html, /sign in, select “I need help,”/);
assert.doesNotMatch(html, /fingerprint|splinter|tarpit|scoring|recursive|telemetry|internal|Bearer|\/admin|\/api\//i, "public pricing must not disclose defense mechanics or privileged surfaces");
assert.doesNotMatch(html, /<form|checkout|stripe|<script/i, "preview must not initiate billing");
assert.match(html, /name="viewport"/);
assert.match(html, /href="#pricing-main"/);
assert.match(html, /<main id="pricing-main"/);
assert.match(html, /aria-describedby="pricing-note"/);
assert.match(html, /href="\/halo-shield\/shield.css"/);
assert.match(html, /href="\/pricing\/pricing.css"/);
assert.match(css, /@media \(max-width: 850px\)/);
assert.match(css, /@media \(max-width: 540px\)/);
assert.match(css, /grid-template-columns: 1fr/);
assert.match(css, /\.plan-enterprise \{ grid-column: auto; \}/);
assert.match(read("halo-shield/shield.css"), /:focus-visible/);
assert.ok(PUBLIC_ROUTE_REGISTRY.some(({ route, file, menuLabel }) =>
  route === "/pricing/" && file === "pricing/index.html" && menuLabel === "PRICING"
), "pricing must participate in public navigation and health checks");
const careMenu = home.match(/<section[^>]*aria-labelledby="halo-lane-care"[\s\S]*?<\/section>/)?.[0];
assert.ok(careMenu, "the homepage must retain its Care menu");
assert.match(careMenu, /href="\/pricing\/"/);
assert.match(careMenu, /data-stat-event="open_pricing"/);
assert.match(careMenu, /renderMenuStatusBadge\('\/pricing\/', 'Pricing'\)/);
assert.match(careMenu, /Explore pricing preview · proposed plans/);
const homePromotion = home.match(/<section(?=[^>]*aria-labelledby="halo-shield-promo-title")[\s\S]*?<\/section>/)?.[0];
assert.ok(homePromotion, "pricing discovery must reuse the existing Shield card");
assert.equal([...home.matchAll(/id="halo-shield-promo-title"/g)].length, 1, "homepage must not duplicate the Shield promotion");
assert.match(homePromotion, /href="\/pricing\/"[^>]*data-stat-event="open_pricing"[^>]*>Explore pricing preview/);
const shieldOverview = read("halo-shield/index.html");
assert.match(shieldOverview, /<aside>[\s\S]*href="\/pricing\/">Explore pricing preview/);
assert.match(shieldOverview, /Public protection outcomes remain visible without a paid plan/);
assert.doesNotMatch(html + homePromotion + careMenu + shieldOverview, /DistroKid|affiliate|referral|\/admin|Bearer/i, "discovery must stay independent and public-facing");
const statusTargets = home.match(/const MENU_STATUS_GROUP_TARGETS = \[([\s\S]*?)\];/)?.[1];
assert.match(statusTargets, /route: '\/pricing\/', label: 'PRICING'/);
assert.match(read("halo-shield/index.html"), /href="\/pricing\/"/);
assert.match(read("netlify.toml"), /from = "\/pricing\/"\s+to = "\/pricing\/index.html"\s+status = 200\s+force = true/);
for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
  const [pathname, anchor] = href.split("#");
  const target = pathname
    ? pathname === "/halo" ? "halo.html" : pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1)
    : "pricing/index.html";
  const content = read(target);
  if (anchor) assert.ok(content.includes(`id="${anchor}"`), `${href} must resolve to an existing anchor`);
}
console.log("Pricing contracts passed.");
