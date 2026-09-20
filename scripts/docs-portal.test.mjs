import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entryRoute,
  localizedHref,
  parseRoute,
  resolvePage,
  routeHref,
} from '../docs/js/portal/routes.js';
import { searchEntries } from '../docs/js/portal/search.js';
import { canonicalEntryId, expandEntryLinks } from '../docs/react/portal/entryLinks.js';

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
});

test('legacy documentation hashes keep their destination in the chosen locale', () => {
  assert.deepEqual(parseRoute('#matrices/multiply-matrix4', 'fr'), {
    locale: 'fr',
    area: 'api',
    id: 'multiply-matrix4',
  });
  assert.deepEqual(parseRoute('#demo/webgpu-demo', 'fr'), {
    locale: 'fr',
    area: 'examples',
    id: 'engine-scene',
  });
  assert.equal(localizedHref('#guides/quick-start', 'fr'), '#/fr/learn/quick-start');
  assert.equal(entryRoute({ id: 'intro', section: 'guides' }, 'en'), '#/en/learn/intro');
});

test('unknown and incomplete routes resolve to stable landing pages', () => {
  assert.deepEqual(parseRoute('#/fr/unknown/place'), { locale: 'fr', area: 'learn', id: 'place' });
  assert.deepEqual(parseRoute('', 'fr'), { locale: 'fr', area: 'learn', id: 'home' });
});

test('search is accent-insensitive, requires every word, and ranks title matches first', () => {
  const entries = [
    { id: 'camera', title: 'Caméra frame', description: 'Projection helpers' },
    { id: 'projection', title: 'Projection', description: 'Camera frame' },
    { id: 'vector', title: 'Vector', description: 'Math helpers' },
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
  const entries = [
    { id: 'quick-start', section: 'guides' },
    { id: 'matrix4', section: 'matrices' },
    { id: 'example-camera', section: 'examples' },
  ];
  assert.equal(resolvePage({ area: 'learn', id: 'quick-start' }, entries).kind, 'entry');
  assert.equal(
    resolvePage({ area: 'examples', id: 'rotate' }, entries, ['rotate']).kind,
    'playground',
  );
  assert.equal(resolvePage({ area: 'examples', id: 'example-camera' }, entries).kind, 'entry');
  assert.equal(resolvePage({ area: 'api', id: 'missing' }, entries).kind, 'not-found');
  assert.equal(resolvePage({ area: 'api', id: '' }, entries).kind, 'api-index');
  assert.equal(
    resolvePage({ area: 'playground', id: 'missing' }, entries, ['rotate']).kind,
    'not-found',
  );
});

test('composite API entries become one navigation link per function', () => {
  const links = expandEntryLinks([
    { id: 'boxUnion', title: 'boxEmpty() · boxIsEmpty() · boxUnion()', section: 'bounds' },
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
