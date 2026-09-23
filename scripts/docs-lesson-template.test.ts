import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import { examples } from '../site/content/catalog.ts';
import type { Playground as PlaygroundComponent } from '../site/app/gallery/Playground.tsx';
import type { EngineExample as EngineExampleComponent } from '../site/app/engine-scene/index.tsx';

const { Playground } = (await loadReactComponents('site/app/gallery/Playground.tsx')) as {
  Playground: typeof PlaygroundComponent;
};
const { EngineExample } = (await loadReactComponents('site/app/engine-scene/index.tsx')) as {
  EngineExample: typeof EngineExampleComponent;
};

interface LessonPage {
  id: string;
  catalogue: boolean;
  render: () => ReactElement;
}

const pages: LessonPage[] = [
  ...examples.map(({ id }) => ({
    id,
    catalogue: true,
    render: () => createElement(Playground, { id, locale: 'en' as const }),
  })),
  {
    id: 'engine-scene',
    catalogue: false,
    render: () => createElement(EngineExample, { locale: 'en' as const }),
  },
];

const rendered = pages.map((page) => ({ ...page, markup: renderToStaticMarkup(page.render()) }));

/** How many elements carry `className`, wherever it sits in their class attribute. */
const rows = (markup: string, className: string): number =>
  (markup.match(new RegExp(`class="[^"]*\\b${className}\\b`, 'g')) ?? []).length;

test('every lesson renders on the one template, none brings its own layout', () => {
  for (const { id: pageId, markup } of rendered) {
    const page = { id: pageId };
    assert.equal((markup.match(/data-lesson=/g) ?? []).length, 1, `${page.id}: one template`);
    assert.equal((markup.match(/<h1 /g) ?? []).length, 1, `${page.id}: one page title`);
    // The reading page's one split: a reading column, then an observing column.
    assert.equal(
      markup.split('xl:grid-cols-[minmax(0,9fr)_minmax(0,11fr)]').length,
      2,
      `${page.id}: one pair of columns`,
    );
  }
});

test('every lesson panel follows the one pattern: picker and buttons, then parameters', () => {
  for (const page of rendered) {
    const { markup } = page;
    assert.equal(rows(markup, 'control-panel-grid'), 1, `${page.id}: one control panel`);
    assert.equal(rows(markup, 'control-panel-pick'), 1, `${page.id}: one picker row`);
    assert.ok(
      rows(markup, 'control-panel-parameters') <= 1,
      `${page.id}: at most one parameter row`,
    );
    // The panel is one section: row one runs from the picker row to the parameters row, or to the
    // end of the panel when the lesson declares no parameter.
    const panel = markup.split('control-panel-pick')[1].split('</section>')[0];
    const pick = panel.split('control-panel-parameters')[0];
    // Row one carries exactly one picker and never a parameter, on every page.
    assert.equal((pick.match(/<select/g) ?? []).length, 1, `${page.id}: one picker in row one`);
    assert.doesNotMatch(pick, /type="range"/, `${page.id}: no parameter in the picker row`);
    if (page.catalogue)
      for (const { id } of examples) assert.ok(pick.includes(`value="${id}"`), `${page.id}: ${id}`);
    // The panel is one section; anything after it (the viewport's own mode picker) is not its row.
    const parameters = (markup.split('control-panel-parameters')[1] ?? '').split('</section>')[0];
    // A parameter may be a select (the engine scene picks a view); the catalogue may not.
    assert.ok(
      !examples.some(({ id }) => parameters.includes(`value="${id}"`)),
      `${page.id}: the catalogue belongs to the picker row`,
    );
  }
});
