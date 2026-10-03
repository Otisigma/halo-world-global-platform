import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const [script, homepage, styles, configuration] = await Promise.all([
  readFile(resolve(root, 'feature-directory.js'), 'utf8'),
  readFile(resolve(root, 'halo.html'), 'utf8'),
  readFile(resolve(root, 'feature-directory.css'), 'utf8'),
  readFile(resolve(root, 'netlify.toml'), 'utf8')
]);
const context = { window: {} };
vm.runInNewContext(script, context);
const directory = context.window.HALOFeatureDirectory;
const entries = Array.from(directory.groups).flatMap(group => Array.from(group.entries));
assert.equal(directory.count, entries.length);
assert.equal(new Set(entries.map(entry => entry.href)).size, entries.length, 'destinations must be unique');
assert.equal(new Set(Array.from(directory.groups, group => group.id)).size, directory.groups.length);

const aliases = new Map();
for (const block of configuration.split('[[redirects]]').slice(1)) {
  const source = block.match(/from = "([^"]+)"/)?.[1];
  const target = block.match(/to = "([^"]+)"/)?.[1];
  if (source && target) aliases.set(source, target);
}
const coveredPages = new Set();
for (const entry of entries) {
  assert.match(entry.href, /^\/(?!\/)/, 'features must link to same-origin destinations');
  assert.ok(entry.title.trim() && entry.description.trim());
  const target = aliases.get(entry.href) || (entry.href.endsWith('/') ? `${entry.href}index.html` : entry.href);
  await access(resolve(root, target.slice(1)));
  coveredPages.add(target.slice(1));
}

const excludedDirectories = new Set(['.git', '.netlify', 'node_modules', 'emails']);
const excludedPages = new Set(['index.html', 'halo.html', '404.html']);
async function checkCoverage(directoryPath) {
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue;
    const target = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) await checkCoverage(target);
    else if (entry.name.endsWith('.html')) {
      const page = relative(root, target);
      if (!excludedPages.has(page)) assert.ok(coveredPages.has(page), `missing feature page: ${page}`);
    }
  }
}
await checkCoverage(root);

const countMatches = groups => groups.reduce((total, group) => total + group.entries.length, 0);
assert.equal(countMatches(directory.filter()), directory.count);
assert.equal(countMatches(directory.filter('   ')), directory.count);
assert.equal(directory.filter('not-a-real-feature').length, 0);
assert.equal(directory.filter('', 'not-a-category').length, 0);
assert.equal(directory.filter('  SONG   CATALOG  ')[0].entries[0].href, '/song-catalog/');
assert.equal(directory.filter('artwork', 'release')[0].entries[0].href, '/artwork-manager.html');
assert.equal(directory.filter('artwork', 'listen').length, 0);
for (const group of directory.groups) {
  assert.equal(countMatches(directory.filter('', group.id)), group.entries.length);
  assert.equal(directory.filter('', group.id)[0].id, group.id);
}
assert.equal(countMatches(directory.filter()), directory.count, 'filtering must not mutate the directory');

assert.match(homepage, /src="\/feature-directory\.js"/);
assert.ok(homepage.indexOf('src="/feature-directory.js"') < homepage.indexOf('type="text/babel"'), 'directory data must load before React renders');
assert.match(homepage, /href="\/feature-directory\.css"/);
assert.match(homepage, /<FeatureDirectory \/>/);
assert.match(homepage, /id="feature-directory"[^>]+aria-labelledby="feature-directory-title"/);
assert.match(homepage, /htmlFor="feature-directory-search"/);
assert.match(homepage, /htmlFor="feature-directory-category"/);
assert.match(homepage, /role="status" aria-live="polite"/);
assert.match(homepage, /No destinations match these filters/);
assert.match(homepage, /setQuery\(''\); setCategory\('all'\)/);
assert.ok((homepage.match(/href="#feature-directory"/g) || []).length >= 3, 'homepage, menu, and footer must link to the directory');
assert.match(styles, /:focus-visible/);
assert.match(styles, /@media \(max-width: 430px\)/);
console.log(`Feature directory contracts passed: ${directory.count} destinations, ${directory.groups.length} pathways, all feature pages covered.`);
