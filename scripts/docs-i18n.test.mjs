import assert from 'node:assert/strict';
import test from 'node:test';
import { BOUNDS } from '../docs/js/docsContentBounds.js';
import { CAMERA, HOST_CAMERA } from '../docs/js/docsContentCamera.js';
import { ENUMS_IMAGE } from '../docs/js/docsContentEnums.js';
import { ENUMS_RUNTIME } from '../docs/js/docsContentEnumsRuntime.js';
import { EXAMPLES } from '../docs/js/docsContentExamples.js';
import { GUIDES } from '../docs/js/docsContentGuides.js';
import { RENDERING_GUIDES } from '../docs/js/docsContentGuidesRendering.js';
import { ENGINE_GUIDES } from '../docs/js/docsContentGuidesEngine.js';
import { LIFECYCLE } from '../docs/js/docsContentLifecycle.js';
import { MATRICES } from '../docs/js/docsContentMatrix.js';
import { BATCHES, TREE } from '../docs/js/docsContentTree.js';
import { COLORS, VECTORS } from '../docs/js/docsContentVector.js';
import { localizeEntries, supportedLocales, t } from '../docs/js/i18n/index.js';
import { localizeDemoText } from '../docs/js/i18n/demo.fr.js';
import { localizedHref, parseRoute } from '../docs/js/portal/routes.js';

const entries = [
  ...GUIDES,
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
  assert.equal(entries.length, 79);
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
  for (const locale of ['en', 'de']) {
    const localized = localizeEntries(entries, locale);
    assert.deepEqual(localized, entries);
    assert.notEqual(localized[0], entries[0]);
  }
});

test('UI strings support both locales and fall back to English by key', () => {
  assert.deepEqual(supportedLocales, ['en', 'fr']);
  assert.equal(t('fr', 'entry.example'), 'Exemple');
  assert.equal(t('de', 'entry.example'), 'Example');
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
    const localized = localizeEntries(entries, locale);
    const explorer = localized.find(({ id }) => id === 'createExplorer');
    assert.match(explorer.description, /interactive: true/);
    assert.match(explorer.description, /ExplorerTarget/);
    assert.match(explorer.values.find(({ name }) => name === 'invalidate()').desc, /camera|caméra/);
    assert.match(explorer.values.find(({ name }) => name === 'dispose()').desc, /Releases|Libère/);
    assert.match(localized.find(({ id }) => id === 'quick-start').html, /interactive: true/);
  }
});
