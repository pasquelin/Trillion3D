import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entryRoute,
  localizedHref,
  parseRoute,
  resolvePage,
  routeHref,
} from '../site/app/portal/routes.ts';
import { searchEntries } from '../site/app/portal/search.ts';
import { rawEntries } from '../site/app/portal/data.ts';
import { localizeEntries } from '../site/content/i18n/index.ts';
import { canonicalEntryId, expandEntryLinks } from '../site/app/portal/entryLinks.ts';
import type { PortalEntry } from '../site/content/model.ts';

test('canonical routes preserve locale, area, and multi-part identifier', () => {
  assert.deepEqual(parseRoute('#/fr/playground/matrix-compose'), {
    locale: 'fr',
    area: 'playground',
    id: 'matrix-compose',
  });
  assert.equal(
    routeHref({ locale: 'en', area: 'learn', id: 'quick start' }),
    '#/en/learn/quick%20start',
  );
  assert.equal(parseRoute('#/fr/api/L%E2%80%99API%20de%20lots').id, 'L’API de lots');
});

test('legacy documentation hashes keep their destination in the chosen locale', () => {
  assert.deepEqual(parseRoute('#matrices/multiply-matrix4', 'fr'), {
    locale: 'fr',
    area: 'api',
    id: 'multiply-matrix4',
  });
  assert.deepEqual(parseRoute('#demo/webgpu-demo', 'fr'), {
    locale: 'fr',
    area: 'lessons',
    id: 'engine-scene',
  });
  assert.equal(localizedHref('#guides/quick-start', 'fr'), '#/fr/learn/quick-start');
  assert.equal(localizedHref('#examples/example-camera', 'en'), '#/en/learn/example-camera');
  assert.equal(localizedHref('#examples', 'en'), '#/en/lessons');
  assert.equal(
    entryRoute({ id: 'intro', section: 'guides', kind: 'Guide', description: '' }, 'en'),
    '#/en/learn/intro',
  );
});

test('unknown and incomplete routes resolve to stable landing pages', () => {
  assert.deepEqual(parseRoute('#/fr/unknown/place'), { locale: 'fr', area: 'learn', id: 'place' });
  assert.deepEqual(parseRoute('', 'fr'), { locale: 'fr', area: 'learn', id: 'home' });
});

test('search is accent-insensitive, requires every word, and ranks title matches first', () => {
  const entries: PortalEntry[] = [
    {
      id: 'camera',
      section: 'guides',
      kind: 'Guide',
      title: 'Caméra frame',
      description: 'Projection helpers',
    },
    {
      id: 'projection',
      section: 'guides',
      kind: 'Guide',
      title: 'Projection',
      description: 'Camera frame',
    },
    {
      id: 'vector',
      section: 'guides',
      kind: 'Guide',
      title: 'Vector',
      description: 'Math helpers',
    },
  ];
  assert.deepEqual(
    searchEntries(entries, 'camera projection').map(({ id }) => id),
    ['camera', 'projection'],
  );
  assert.deepEqual(
    searchEntries(entries, 'CAMÉRA').map(({ id }) => id),
    ['camera', 'projection'],
  );
  assert.equal(searchEntries(entries, 'texture').length, 0);
});

test('page resolution distinguishes entries, playgrounds, and unknown addresses', () => {
  const entries: PortalEntry[] = [
    { id: 'quick-start', section: 'guides', kind: 'Guide', description: '' },
    { id: 'matrix4', section: 'matrices', kind: 'Type', description: '' },
    { id: 'example-camera', section: 'examples', kind: 'Guide', description: '' },
  ];
  const locale = 'en' as const;
  assert.equal(resolvePage({ locale, area: 'learn', id: 'quick-start' }, entries).kind, 'entry');
  assert.equal(
    resolvePage({ locale, area: 'lessons', id: 'rotate' }, entries, ['rotate']).kind,
    'playground',
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
  assert.equal(
    resolvePage({ locale, area: 'playground', id: 'missing' }, entries, ['rotate']).kind,
    'not-found',
  );
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
      ({ section }) => !['guides', 'examples', 'demo'].includes(section),
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
