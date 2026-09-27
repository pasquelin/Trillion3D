import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Examples as ExamplesComponent } from '../site/app/examples/Examples.tsx';
import { examplePlaceholder, exampleTitle, themedEntries } from '../site/app/examples/list.ts';
import { dictionaryOf, LANGUAGES, loadDictionary } from '../site/content/i18n/dictionary.ts';
import { loadReactComponents } from './docs/render-react.ts';

test('a missing thumbnail falls back once and leaves a missing placeholder alone', async () => {
  const { showFallbackImage } = (await loadReactComponents('site/app/ui/Thumbnail.tsx')) as {
    showFallbackImage: (
      image: { getAttribute(name: string): string | null; src: string },
      fallbackSrc: string,
    ) => void;
  };
  let source = './assets/examples/thumbnails/missing.png';
  let assignments = 0;
  const image = {
    getAttribute: (name: string) => (name === 'src' ? source : null),
    get src() {
      return source;
    },
    set src(value: string) {
      source = value;
      assignments++;
    },
  };
  showFallbackImage(image, examplePlaceholder);
  showFallbackImage(image, examplePlaceholder);
  assert.equal(source, examplePlaceholder);
  assert.equal(assignments, 1);
});

test("every language names each theme's unwritten examples in its coming line", async () => {
  const { Examples } = (await loadReactComponents('site/app/examples/Examples.tsx')) as {
    Examples: typeof ExamplesComponent;
  };
  await Promise.all(LANGUAGES.map(({ code }) => loadDictionary(code)));
  for (const { code } of LANGUAGES) {
    const page = renderToStaticMarkup(createElement(Examples, { locale: code }));
    for (const { coming } of themedEntries) {
      if (!coming.length) continue;
      const titles = coming.map(({ id }) => exampleTitle(id, code)).join(' · ');
      const line = dictionaryOf(code).examples.coming.replace('{{titles}}', titles);
      const escaped = renderToStaticMarkup(createElement('span', null, line)).slice(6, -7);
      assert.ok(page.includes(escaped), `${code}: ${line}`);
    }
  }
});
