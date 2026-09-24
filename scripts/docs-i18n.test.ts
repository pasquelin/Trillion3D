import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import { compareKeys, describeMismatches, keyMismatches } from './i18n-keys.ts';
import { entrySummary } from '../site/content/model.ts';
import { DEFAULT_LANGUAGE, dictionaryOf, LANGUAGES } from '../site/content/i18n/dictionary.ts';
import { localizeDemoText } from '../site/content/i18n/canvas.ts';
import { NOTES } from '../site/content/entries/reference.ts';
import { entriesIn, loadEntries } from '../site/app/portal/data.ts';
import type { Header as HeaderComponent } from '../site/app/layout/Header.tsx';

const CODES = LANGUAGES.map(({ code }) => code);
// Every language's words and reference translation, as a page in it reads them first.
await Promise.all(CODES.map(loadEntries));
const english = entriesIn(DEFAULT_LANGUAGE);

test('every language gives exactly the keys English gives', () => {
  const mismatches = keyMismatches();
  assert.deepEqual(mismatches, [], describeMismatches(mismatches));
});

test('a key given on one side only is named, missing or extra', () => {
  const found = compareKeys('site/i18n/xx.json', ['nav.learn', 'nav.api'], ['nav.api', 'nav.a']);
  assert.deepEqual(found, [
    { file: 'site/i18n/xx.json', missing: ['nav.learn'], extra: ['nav.a'] },
  ]);
  assert.match(describeMismatches(found), /missing nav\.learn\n {2}extra {3}nav\.a/);
  assert.deepEqual(compareKeys('site/i18n/xx.json', ['a'], ['a']), []);
});

test('the languages are the files of site/i18n, English first', () => {
  const files = readdirSync(new URL('../site/i18n/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length));
  assert.deepEqual([...CODES].sort(), files.sort());
  assert.equal(CODES[0], DEFAULT_LANGUAGE);
});

test('another language keeps every entry and its technical contract, and translates its text', () => {
  for (const locale of CODES.filter((code) => code !== DEFAULT_LANGUAGE)) {
    const localized = entriesIn(locale);
    assert.equal(localized.length, english.length);
    english.forEach((source, index) => {
      const entry = localized[index];
      for (const field of ['id', 'signature', 'module', 'example', 'exports'] as const)
        assert.equal(entry[field], source[field], `${source.id}.${field}`);
      const translated =
        entry.description !== source.description || entrySummary(entry) !== entrySummary(source);
      assert.ok(translated, `${locale}: ${source.id} has no text of its own`);
      for (const rows of ['values', 'parameters', 'members'] as const)
        assert.deepEqual(
          entry[rows]?.map(({ name }) => name),
          source[rows]?.map(({ name }) => name),
          `${locale}: ${source.id} renames a row of its ${rows}`,
        );
    });
  }
});

test('a language without a dictionary reads the English entries', () => {
  const words = ({ title, description, html }: (typeof english)[number]) => ({
    title,
    description,
    html,
  });
  assert.deepEqual(entriesIn('xx').map(words), english.map(words));
});

test('a written table explains each word its note names, in order', () => {
  const written: Record<string, { title?: string; description?: string; values?: string[] }> =
    dictionaryOf(DEFAULT_LANGUAGE).written;
  for (const note of NOTES.values())
    assert.equal(written[note.id]?.values?.length, note.valueNames?.length, note.id);
});

test('a demo canvas label is translated, its technical symbols and values kept', () => {
  assert.equal(localizeDemoText('field of view (°)', 'fr'), 'champ de vision (°)');
  assert.equal(localizeDemoText('kept', 'fr'), 'conservé');
  assert.equal(localizeDemoText('kept', 'en'), 'kept');
  assert.equal(localizeDemoText('before (y 0)', 'fr'), 'avant (y 0)');
  assert.equal(
    localizeDemoText(
      'determinant 0: sixteen zeros, like the reference — test the determinant, never the output',
      'fr',
    ),
    'déterminant 0 : seize zéros comme la référence ; testez le déterminant, jamais la sortie',
  );
  assert.equal(localizeDemoText('multiplyMatrix4(out, a, b)', 'fr'), 'multiplyMatrix4(out, a, b)');
  assert.equal(localizeDemoText('constructor', 'fr'), 'constructor');
});

test('every language describes the world: its options row by row, and each of its members', () => {
  for (const locale of CODES) {
    const localized = entriesIn(locale);
    const world = localized.find(({ id }) => id === 'createWorld');
    assert(world);
    const interactive = world.parameters?.find(({ name }) => name === 'options.interactive?');
    assert.equal(interactive?.default, 'true');
    for (const member of ['world.invalidate', 'world.dispose', 'world.scene'])
      assert.ok(entrySummary(localized.find(({ id }) => id === member)!), member);
  }
});

test('the course is eleven chapters in every language, each linking the next', () => {
  for (const locale of CODES) {
    const chapters = entriesIn(locale).filter(({ section }) => section === 'course');
    assert.equal(chapters.length, 11);
    chapters.forEach((chapter, index) => {
      assert.match(chapter.title ?? '', new RegExp(`^${index + 1}\\. `));
      const next = chapters[index + 1];
      const target = next ? `#/${locale}/learn/${next.id}` : `#/${locale}/examples`;
      assert.equal(chapter.chapter?.next.href, target, chapter.id);
      assert.ok(chapter.chapter.code.length > 0 && chapter.chapter.steps.length > 0, chapter.id);
      assert.doesNotMatch(chapter.description, /<code>/, chapter.id);
    });
  }
});

test('the header offers every language, each a link to the same page in it', async () => {
  // The theme switch reads the system theme, and a remembered one this test has none of.
  Object.assign(globalThis, { matchMedia: () => ({ matches: false }) });
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
  const { Header } = (await loadReactComponents('site/app/layout/Header.tsx')) as {
    Header: typeof HeaderComponent;
  };
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(Header, { drawerOpen: false, onMenu: noop, onSearch: noop }),
  );
  // Each language behind its flag, a served SVG; the current one's flag on the button too.
  for (const { code, name, hreflang, flag } of LANGUAGES)
    assert.match(
      html,
      new RegExp(
        `<a href="#/${code}/learn/home" hrefLang="${hreflang}"[^>]*><img[^>]*src="./flags/${flag}.svg" alt=""[^>]*/><span class="truncate">${name}</span>`,
      ),
    );
  assert.match(html, /aria-current="page"[^>]*><img[^>]*\/><span class="truncate">English</);
  assert.match(html, /<summary[^>]*><img[^>]*src=".\/flags\/us.svg" alt="English"/);
});
