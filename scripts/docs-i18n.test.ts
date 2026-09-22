import assert from 'node:assert/strict';
import test from 'node:test';
import { BOUNDS } from '../site/content/entries/bounds.ts';
import { CAMERA, HOST_CAMERA } from '../site/content/entries/camera.ts';
import { ENUMS_IMAGE } from '../site/content/entries/enums.ts';
import { ENUMS_RUNTIME } from '../site/content/entries/enumsRuntime.ts';
import { EXAMPLES } from '../site/content/entries/examples.ts';
import { FORMAT_GUIDES } from '../site/content/entries/format.ts';
import { GUIDES } from '../site/content/entries/guides.ts';
import { RENDERING_GUIDES } from '../site/content/entries/guidesRendering.ts';
import { ENGINE_GUIDES } from '../site/content/entries/guidesEngine.ts';
import { LIFECYCLE } from '../site/content/entries/lifecycle.ts';
import { MATRICES } from '../site/content/entries/matrix.ts';
import { TREE } from '../site/content/entries/tree.ts';
import { BATCHES } from '../site/content/entries/batches.ts';
import { COLORS, VECTORS } from '../site/content/entries/vector.ts';
import { localizeEntries, supportedLocales, t } from '../site/content/i18n/index.ts';
import { rawEntries } from '../site/app/portal/data.ts';
import { localizeDemoText } from '../site/content/i18n/demo.fr.ts';
import { localizedHref, parseRoute } from '../site/app/portal/routes.ts';
import type { Locale } from '../site/content/locale.ts';

const entries = [
  ...GUIDES,
  ...FORMAT_GUIDES,
  ...RENDERING_GUIDES,
  ...ENGINE_GUIDES,
  ...EXAMPLES,
  ...ENUMS_IMAGE,
  ...ENUMS_RUNTIME,
  ...LIFECYCLE,
  ...CAMERA,
  ...HOST_CAMERA,
  ...MATRICES,
  ...VECTORS,
  ...COLORS,
  ...BOUNDS,
  ...TREE,
  ...BATCHES,
];

test('French content covers every documentation entry and preserves its technical contract', () => {
  const localized = localizeEntries(entries, 'fr');
  assert.equal(entries.length, 89);
  assert.equal(localized.length, entries.length);
  for (let index = 0; index < entries.length; index += 1) {
    const source = entries[index];
    const french = localized[index];
    assert.equal(french.id, source.id);
    assert.equal(french.signature, source.signature);
    assert.equal(french.module, source.module);
    assert.equal(french.example, source.example);
    assert.equal(french.exports, source.exports);
    assert.notEqual(
      french.description,
      source.description,
      `${source.id} has no French description`,
    );
    assert.deepEqual(
      french.values?.map(({ name }) => name),
      source.values?.map(({ name }) => name),
    );
  }
});

test('English and unsupported locales preserve source content without sharing entry objects', () => {
  // 'de' is deliberately outside the `Locale` union: localizeEntries falls back to source content
  // for any unsupported locale, a guarantee this test checks beyond the static type contract.
  for (const locale of ['en', 'de'] as Locale[]) {
    const localized = localizeEntries(rawEntries, locale);
    assert.deepEqual(localized, rawEntries);
    assert.notEqual(localized[0], rawEntries[0]);
  }
});

test('UI strings support both locales and fall back to English by key', () => {
  assert.deepEqual(supportedLocales, ['en', 'fr']);
  assert.equal(t('fr', 'entry.example'), 'Exemple');
  // Same deliberate out-of-union locale as above: t() falls back to English by key.
  assert.equal(t('de' as Locale, 'entry.example'), 'Example');
  assert.equal(t('fr', 'missing.key'), 'missing.key');
});

test('legacy demo labels are localized without changing technical symbols', () => {
  assert.equal(localizeDemoText('field of view (°)', 'fr'), 'champ de vision (°)');
  assert.equal(localizeDemoText('kept', 'fr'), 'conservé');
  assert.equal(
    localizeDemoText('a and b, seen from above (x to the right, z down)', 'fr'),
    'a et b vus du dessus (x vers la droite, z vers le bas)',
  );
  assert.equal(
    localizeDemoText('the world from above, each box coloured by what the engine decided', 'fr'),
    'le monde vu du dessus, chaque boîte colorée selon la décision du moteur',
  );
  assert.equal(localizeDemoText('before (y 0)', 'fr'), 'avant (y 0)');
  assert.equal(
    localizeDemoText(
      'determinant 0: sixteen zeros, like the reference — test the determinant, never the output',
      'fr',
    ),
    'déterminant 0 : seize zéros comme la référence ; testez le déterminant, jamais la sortie',
  );
  assert.equal(localizeDemoText('multiplyMatrix4(out, a, b)', 'fr'), 'multiplyMatrix4(out, a, b)');
});

test('legacy documentation hashes retain the active locale', () => {
  assert.deepEqual(parseRoute('#matrices/multiplyMatrix4', 'fr'), {
    locale: 'fr',
    area: 'api',
    id: 'multiplyMatrix4',
  });
  assert.equal(localizedHref('#guides/quick-start', 'fr'), '#/fr/learn/quick-start');
});

test('both locales describe interactive startup and align every method description', () => {
  for (const locale of supportedLocales) {
    const localized = localizeEntries(rawEntries, locale);
    const world = localized.find(({ id }) => id === 'createWorld');
    assert(world);
    assert.match(world.description, /`interactive`/);
    assert.match(world.description, /`scene\.load`/);
    const invalidate = world.values?.find(({ name }) => name.includes('invalidate()'));
    const dispose = world.values?.find(({ name }) => name === 'dispose()');
    assert(invalidate);
    assert(dispose);
    assert.match(invalidate.desc, /frame|image/i);
    assert.match(dispose.desc, /Releases|Libère/);
    const quickStart = localized.find(({ id }) => id === 'quick-start');
    assert(quickStart);
    assert(quickStart.html);
    assert.match(quickStart.html, /createWorld/);
  }
});
