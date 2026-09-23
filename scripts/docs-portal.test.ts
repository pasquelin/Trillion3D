import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entryRoute,
  LEARN_SECTIONS,
  navLinks,
  parseRoute,
  resolvePage,
  routeHref,
} from '../site/app/portal/routes.ts';
import { search } from '../site/app/portal/search.ts';
import { searchIndex } from '../site/app/portal/searchIndex.ts';
import { exampleTitle, readyEntries } from '../site/app/examples/list.ts';
import { entriesIn, loadEntries } from '../site/app/portal/data.ts';
import { canonicalEntryId, expandEntryLinks } from '../site/app/portal/entryLinks.ts';
import type { PortalEntry } from '../site/content/model.ts';

// The French words are read as a page in French reads them; English is bundled.
await loadEntries('fr');
const english = entriesIn('en');

test('canonical routes preserve locale, area, and multi-part identifier', () => {
  assert.deepEqual(parseRoute('#/fr/api/geometry/matrix4'), {
    locale: 'fr',
    area: 'api',
    id: 'geometry/matrix4',
  });
  assert.equal(
    routeHref({ locale: 'en', area: 'learn', id: 'quick start' }),
    '#/en/learn/quick%20start',
  );
  assert.equal(parseRoute('#/fr/api/L%E2%80%99API%20de%20lots').id, 'L’API de lots');
  assert.equal(
    entryRoute({ id: 'intro', section: 'guides', kind: 'Guide', description: '' }, 'en'),
    '#/en/learn/intro',
  );
});

test('the removed legacy routes no longer lead anywhere', () => {
  // The pre-portal hashes open the home page instead of being redirected.
  for (const hash of ['#matrices/multiply-matrix4', '#demo/webgpu-demo', '#examples', '#guides/x'])
    assert.deepEqual(parseRoute(hash, 'fr'), { locale: 'fr', area: 'learn', id: 'home' });
  // The Playground and Lessons areas and the empty demo section are gone: their addresses find
  // no page.
  for (const hash of [
    '#/en/playground/compose-transform',
    '#/en/lessons/matrix-inverse',
    '#/en/demo/webgpu-demo',
  ]) {
    const route = parseRoute(hash);
    assert.equal(route.area, 'learn');
    assert.equal(resolvePage(route, english).kind, 'not-found', hash);
  }
  assert.ok(!english.some(({ section }) => section === 'demo'));
});

test('the header marks the area of the route, the editor an area of its own', () => {
  const current = (hash: string) =>
    navLinks(parseRoute(hash))
      .filter((link) => link.current)
      .map(({ area, href }) => `${area} ${href}`);
  assert.deepEqual(current('#/fr/learn/create-a-world'), ['learn #/fr/learn/home']);
  assert.deepEqual(current('#/en/examples/cube'), ['examples #/en/examples']);
  assert.deepEqual(current('#/fr/editor'), ['editor #/fr/editor']);
  assert.deepEqual(current('#/en/api/createWorld'), ['api #/en/api']);
  assert.deepEqual(current('#/fr/reports/september-18/compare'), ['reports #/fr/reports']);
  assert.deepEqual(current('#/fr/sandbox/a-neon-sign'), ['sandbox #/fr/sandbox']);
  assert.deepEqual(
    navLinks(parseRoute('#/en/api')).map(({ area }) => area),
    ['learn', 'sandbox', 'examples', 'editor', 'api', 'reports'],
  );
});

test('unknown and incomplete routes resolve to stable landing pages', () => {
  assert.deepEqual(parseRoute('#/fr/unknown/place'), {
    locale: 'fr',
    area: 'learn',
    id: 'unknown/place',
  });
  assert.deepEqual(parseRoute('#/fr'), { locale: 'fr', area: 'learn', id: 'home' });
  assert.deepEqual(parseRoute('', 'fr'), { locale: 'fr', area: 'learn', id: 'home' });
});

test('search is accent-insensitive, requires every word, and ranks title matches first', () => {
  const items = [
    { id: 'camera', title: 'Caméra frame', text: 'Projection helpers' },
    { id: 'projection', title: 'Projection', text: 'Camera frame' },
    { id: 'vector', title: 'Vector', text: 'Math helpers' },
  ];
  assert.deepEqual(
    search(items, 'camera projection').map(({ id }) => id),
    ['camera', 'projection'],
  );
  assert.deepEqual(
    search(items, 'CAMÉRA').map(({ id }) => id),
    ['camera', 'projection'],
  );
  assert.equal(search(items, 'texture').length, 0);
});

test('the site search reads every guide, API entry and ready example in the language', () => {
  const entries = entriesIn('fr');
  const index = searchIndex(entries, 'fr');
  assert.equal(new Set(index.map(({ key }) => key)).size, index.length);
  for (const entry of entries) assert.ok(index.some(({ key }) => key === `entry:${entry.id}`));
  const [ready] = readyEntries;
  const [example] = search(index, exampleTitle(ready.id, 'fr'));
  assert.equal(example.href, `#/fr/examples/${ready.id}`);
  assert.equal(example.kind, 'Exemple');
});

test('page resolution distinguishes entries, examples, and unknown addresses', () => {
  const entries: PortalEntry[] = [
    { id: 'create-a-world', section: 'course', kind: 'Chapter', description: '' },
    { id: 'matrix4', section: 'matrices', kind: 'Type', description: '' },
    { id: 'architecture', section: 'internals', kind: 'Guide', description: '' },
  ];
  const locale = 'en' as const;
  assert.equal(resolvePage({ locale, area: 'learn', id: 'create-a-world' }, entries).kind, 'entry');
  assert.equal(resolvePage({ locale, area: 'learn', id: 'architecture' }, entries).kind, 'entry');
  assert.equal(
    resolvePage({ locale, area: 'examples', id: 'architecture' }, entries).kind,
    'not-found',
  );
  assert.equal(
    entryRoute({ id: 'architecture', section: 'internals', kind: 'Guide', description: '' }, 'en'),
    '#/en/learn/architecture',
  );
  assert.equal(resolvePage({ locale, area: 'examples', id: '' }, entries).kind, 'examples');
  assert.equal(resolvePage({ locale, area: 'editor', id: '' }, entries).kind, 'editor');
  assert.equal(
    resolvePage({ locale, area: 'examples', id: 'scene-editor' }, entries).kind,
    'not-found',
  );
  assert.equal(
    resolvePage({ locale, area: 'examples', id: 'cube' }, entries, ['cube']).kind,
    'example',
  );
  assert.equal(resolvePage({ locale, area: 'examples', id: 'cube' }, entries).kind, 'not-found');
  assert.equal(resolvePage({ locale, area: 'api', id: 'missing' }, entries).kind, 'not-found');
  assert.equal(resolvePage({ locale, area: 'api', id: '' }, entries).kind, 'api-index');
});

test('composite API entries become one navigation link per function', () => {
  const links = expandEntryLinks([
    {
      id: 'boxUnion',
      title: 'boxEmpty() · boxIsEmpty() · boxUnion()',
      section: 'bounds',
      kind: 'Function',
      description: '',
    },
  ]);
  assert.deepEqual(
    links.map(({ label }) => label),
    ['boxEmpty()', 'boxIsEmpty()', 'boxUnion()'],
  );
  assert.deepEqual(
    links.filter(({ primary }) => primary).map(({ label }) => label),
    ['boxUnion()'],
  );
  assert.ok(links.every(({ entry }) => entry.id === 'boxUnion'));
  assert.equal(canonicalEntryId([links[0].entry], 'boxIsEmpty'), 'boxUnion');
  assert.equal(canonicalEntryId([links[0].entry], 'boxUnion'), 'boxUnion');
});

test('localized prose titles keep canonical routes and old encoded links still resolve', () => {
  const frenchEntry: PortalEntry = {
    id: 'host-batches',
    title: 'L’API de lots pour les hôtes',
    section: 'batches',
    kind: 'Function',
    description: '',
  };
  const [link] = expandEntryLinks([frenchEntry]);
  assert.equal(link.id, 'host-batches');
  assert.equal(
    canonicalEntryId([frenchEntry], 'L%E2%80%99API%20de%20lots%20pour%20les%20h%C3%B4tes'),
    'host-batches',
  );
});

test('every bilingual API menu link resolves to its source entry', () => {
  for (const locale of ['en', 'fr'] as const) {
    const entries = entriesIn(locale).filter(({ section }) => !LEARN_SECTIONS.includes(section));
    for (const link of expandEntryLinks(entries)) {
      assert.equal(canonicalEntryId(entries, link.id), link.entry.id, `${locale}:${link.id}`);
      assert.equal(
        resolvePage({ locale, area: 'api', id: link.entry.id }, entries).kind,
        'entry',
        `${locale}:${link.entry.id}`,
      );
    }
  }
});
