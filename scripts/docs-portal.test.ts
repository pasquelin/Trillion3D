import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entryRoute,
  navLinks,
  parseRoute,
  resolvePage,
  routeHref,
} from '../site/app/portal/routes.ts';
import { search } from '../site/app/portal/search.ts';
import { searchIndex } from '../site/app/portal/searchIndex.ts';
import { readyEntries } from '../site/app/examples/list.ts';
import { rawEntries } from '../site/app/portal/data.ts';
import { localizeEntries } from '../site/content/i18n/index.ts';
import { canonicalEntryId, expandEntryLinks } from '../site/app/portal/entryLinks.ts';
import type { PortalEntry } from '../site/content/model.ts';

test('canonical routes preserve locale, area, and multi-part identifier', () => {
  assert.deepEqual(parseRoute('#/fr/lessons/matrix-compose'), {
    locale: 'fr',
    area: 'lessons',
    id: 'matrix-compose',
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
  // The Playground area and the empty demo section are gone: their addresses find no page.
  for (const hash of ['#/en/playground/compose-transform', '#/en/demo/webgpu-demo']) {
    const route = parseRoute(hash);
    assert.equal(route.area, 'learn');
    assert.equal(resolvePage(route, rawEntries, ['compose-transform']).kind, 'not-found', hash);
  }
  assert.ok(!rawEntries.some(({ section }) => section === 'demo'));
});

test('the header marks the area of the route, the lessons under Learn', () => {
  const current = (hash: string) =>
    navLinks(parseRoute(hash))
      .filter((link) => link.current)
      .map(({ area, href }) => `${area} ${href}`);
  assert.deepEqual(current('#/fr/learn/quick-start'), ['learn #/fr/learn/home']);
  assert.deepEqual(current('#/en/lessons/rotate'), ['learn #/en/learn/home']);
  assert.deepEqual(current('#/en/examples/cube'), ['examples #/en/examples']);
  assert.deepEqual(current('#/en/api/createWorld'), ['api #/en/api']);
  assert.deepEqual(current('#/fr/reports/september-18/compare'), ['reports #/fr/reports']);
  assert.deepEqual(
    navLinks(parseRoute('#/en/api')).map(({ area }) => area),
    ['learn', 'examples', 'api', 'reports'],
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

test('the site search reads every guide, API entry, ready example and lesson in the language', () => {
  const entries = localizeEntries(rawEntries, 'fr');
  const index = searchIndex(entries, 'fr');
  assert.equal(new Set(index.map(({ key }) => key)).size, index.length);
  for (const entry of entries) assert.ok(index.some(({ key }) => key === `entry:${entry.id}`));
  const [ready] = readyEntries;
  const [example] = search(index, ready.title.fr);
  assert.equal(example.href, `#/fr/examples/${ready.id}`);
  assert.equal(example.kind, 'Exemple');
  assert.ok(index.some(({ href }) => href.startsWith('#/fr/lessons/')));
});

test('page resolution distinguishes entries, lessons, and unknown addresses', () => {
  const entries: PortalEntry[] = [
    { id: 'quick-start', section: 'guides', kind: 'Guide', description: '' },
    { id: 'matrix4', section: 'matrices', kind: 'Type', description: '' },
    { id: 'example-camera', section: 'examples', kind: 'Guide', description: '' },
  ];
  const locale = 'en' as const;
  assert.equal(resolvePage({ locale, area: 'learn', id: 'quick-start' }, entries).kind, 'entry');
  assert.equal(
    resolvePage({ locale, area: 'lessons', id: 'rotate' }, entries, ['rotate']).kind,
    'lesson',
  );
  assert.equal(resolvePage({ locale, area: 'learn', id: 'example-camera' }, entries).kind, 'entry');
  assert.equal(
    resolvePage({ locale, area: 'examples', id: 'example-camera' }, entries).kind,
    'not-found',
  );
  assert.equal(
    entryRoute({ id: 'example-camera', section: 'examples', kind: 'Guide', description: '' }, 'en'),
    '#/en/learn/example-camera',
  );
  assert.equal(resolvePage({ locale, area: 'examples', id: '' }, entries).kind, 'examples');
  assert.equal(
    resolvePage({ locale, area: 'examples', id: 'cube' }, entries, [], ['cube']).kind,
    'example',
  );
  assert.equal(
    resolvePage({ locale, area: 'examples', id: 'cube' }, entries, ['cube']).kind,
    'not-found',
  );
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
    const entries = localizeEntries(rawEntries, locale).filter(
      ({ section }) => !['guides', 'examples'].includes(section),
    );
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
