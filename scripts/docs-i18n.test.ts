import assert from 'node:assert/strict';
import test from 'node:test';
import { entrySummary } from '../site/content/model.ts';
import { localizeEntries, supportedLocales, t } from '../site/content/i18n/index.ts';
import { rawEntries } from '../site/app/portal/data.ts';
import { localizeDemoText } from '../site/content/i18n/demo.fr.ts';
import { STRINGS } from '../site/content/i18n/strings.ts';
import type { Locale } from '../site/content/locale.ts';

test('French content covers every documentation entry and preserves its technical contract', () => {
  const localized = localizeEntries(rawEntries, 'fr');
  assert.equal(localized.length, rawEntries.length);
  for (let index = 0; index < rawEntries.length; index += 1) {
    const source = rawEntries[index];
    const french = localized[index];
    assert.equal(french.id, source.id);
    assert.equal(french.signature, source.signature);
    assert.equal(french.module, source.module);
    assert.equal(french.example, source.example);
    assert.equal(french.exports, source.exports);
    const translated =
      french.description !== source.description || entrySummary(french) !== entrySummary(source);
    assert.ok(translated, `${source.id} has no French text`);
    for (const rows of ['values', 'parameters', 'members'] as const)
      assert.deepEqual(
        french[rows]?.map(({ name }) => name),
        source[rows]?.map(({ name }) => name),
        `${source.id}: the French ${rows} rename a row`,
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
  assert.deepEqual(Object.keys(STRINGS.fr).sort(), Object.keys(STRINGS.en).sort());
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

test('both locales describe the world: its options row by row, and each of its members', () => {
  for (const locale of supportedLocales) {
    const localized = localizeEntries(rawEntries, locale);
    const world = localized.find(({ id }) => id === 'createWorld');
    assert(world);
    const interactive = world.parameters?.find(({ name }) => name === 'options.interactive?');
    assert.equal(interactive?.default, 'true');
    assert.match(interactive.desc, /loop|boucle/);
    for (const member of ['world.invalidate', 'world.dispose', 'world.scene'])
      assert.ok(entrySummary(localized.find(({ id }) => id === member)!), member);
  }
});

test('the course is nine chapters in both locales, each linking the next and showing its example live', () => {
  for (const locale of supportedLocales) {
    const chapters = localizeEntries(rawEntries, locale).filter(
      ({ section }) => section === 'course',
    );
    assert.equal(chapters.length, 9);
    chapters.forEach((chapter, index) => {
      assert.match(chapter.title ?? '', new RegExp(`^${index + 1}\\. `));
      const next = chapters[index + 1];
      const target = next ? `#/${locale}/learn/${next.id}` : `#/${locale}/examples`;
      assert.ok(chapter.html?.includes(`href="${target}"`), chapter.id);
      assert.match(chapter.html ?? '', /<iframe src="examples\/[a-z-]+\.html"/);
      assert.doesNotMatch(chapter.description, /<code>/, chapter.id);
    });
  }
});
