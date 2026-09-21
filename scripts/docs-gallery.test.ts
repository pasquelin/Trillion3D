import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import { codeFor } from '../site/lessons/code.ts';
import { evaluate } from '../site/lessons/evaluate.ts';
import { geometryFor } from '../site/lessons/sceneGeometry.ts';
import { draw, legendAnchors } from '../site/lessons/draw.ts';
import type { SvgHost } from '../site/lessons/drawPrimitives.ts';
import { initialState } from '../site/lessons/scenarios.ts';
import { examples } from '../site/content/catalog.ts';
import { rendererLessons } from '../site/lessons/rendererLessons.ts';
import { expectedResultFor } from './docs/expected-result.ts';
import type { Locale } from '../site/content/locale.ts';
import type { Gallery as GalleryComponent } from '../site/app/gallery/Gallery.tsx';
import type { Playground as PlaygroundComponent } from '../site/app/gallery/Playground.tsx';
import type { Home as HomeComponent } from '../site/app/portal/Home.tsx';
import type { CodeBlock as CodeBlockComponent } from '../site/app/components/CodeBlock.tsx';

const root = new URL('../site/lessons/', import.meta.url);
const { Gallery } = (await loadReactComponents('site/app/gallery/Gallery.tsx')) as {
  Gallery: typeof GalleryComponent;
};
const { Playground } = (await loadReactComponents('site/app/gallery/Playground.tsx')) as {
  Playground: typeof PlaygroundComponent;
};
const { Home } = (await loadReactComponents('site/app/portal/Home.tsx')) as {
  Home: typeof HomeComponent;
};
const { CodeBlock } = (await loadReactComponents('site/app/components/CodeBlock.tsx')) as {
  CodeBlock: typeof CodeBlockComponent;
};
const renderGallery = (locale: Locale) => renderToStaticMarkup(createElement(Gallery, { locale }));
const renderPlayground = (id: string, locale: Locale) =>
  renderToStaticMarkup(createElement(Playground, { id, locale }));
const mathExamples = examples.filter(({ renderer }) => !renderer);

test('gallery exposes bilingual math and public renderer lessons', () => {
  assert.equal(examples.length, 57);
  assert.equal(rendererLessons.length, 41);
  assert.equal(new Set(examples.map(({ id }) => id)).size, examples.length);
  for (const example of examples) {
    assert.ok(example.title.en && example.title.fr);
    assert.ok(example.description.en && example.description.fr);
    assert.ok(example.functions);
    assert.ok(example.functions.length > 0);
  }
  assert.match(renderGallery('fr'), /Décisions du frustum/);
  assert.match(renderPlayground('dot-product', 'en'), /Dot product as alignment/);
  assert.match(renderPlayground('dot-product', 'fr'), /aria-label=/);
  assert.match(renderPlayground('dot-product', 'en'), /<h1 class=/);
  assert.match(renderPlayground('dot-product', 'en'), /Copy code/);
  assert.match(renderPlayground('point-light-range', 'fr'), /data-lesson/);
});

test('shared code blocks escape markup and preserve the copied source', () => {
  const source = 'const tag = "<mesh>";\nreturn tag;\n';
  const html = renderToStaticMarkup(
    createElement(CodeBlock, { code: source, locale: 'fr', label: 'Signature' }),
  );
  assert.match(html, /class="mockup-code w-full"/);
  assert.match(html, /class="code-scroll"/);
  assert.match(html, /Signature/);
  assert.match(html, /&lt;mesh&gt;/);
  assert.doesNotMatch(html, /data-code-label/);
  assert.equal((html.match(/data-prefix=/g) ?? []).length, source.split('\n').length);
});

test('diagram legends assign a distinct fixed anchor to every label', () => {
  const anchors = legendAnchors(4);
  assert.equal(new Set(anchors.map(({ x, y }) => `${x}:${y}`)).size, anchors.length);
  assert.ok(anchors.every(({ x, y }) => x >= 40 && x < 640 && y === 24));
});

test('all four advanced lessons mount their complementary diagram with finite geometry', () => {
  class SvgNode implements SvgHost {
    children: Element[] = [];
    setAttribute(name: string, value: string) {
      assert.doesNotMatch(String(value), /NaN|undefined/, name);
    }
    append(...children: Element[]) {
      this.children.push(...children);
    }
    replaceChildren(...children: Element[]) {
      this.children = children;
    }
  }
  const previous = globalThis.document;
  // `document` does not exist in Node: this stub only ever serves `createElementNS`, the one
  // member `add()` (site/lessons/drawPrimitives.ts) calls; the `Document` type is asserted through
  // the generic, an empty (so non-conflicting) target for the `Proxy` constructor to widen from.
  globalThis.document = new Proxy({} as Document, {
    get(_target, property) {
      if (property === 'createElementNS') return () => new SvgNode();
      return undefined;
    },
  });
  try {
    for (const id of [
      'matrix-inverse',
      'reflection-orientation',
      'quaternion-turn',
      'normal-transform',
    ]) {
      const state = initialState(id);
      const svg = new SvgNode();
      draw(svg, evaluate(id, state, 'fr'), 'fr');
      assert.ok(svg.children.length > 3, id);
    }
  } finally {
    globalThis.document = previous;
  }
});

test('gallery renders visual, searchable cards and the real engine scene', () => {
  const gallery = renderGallery('en');
  assert.match(gallery, /type="search"/);
  assert.match(gallery, /aria-pressed="true"/);
  assert.match(gallery, /tabs tabs-box bg-base-200/);
  assert.match(gallery, />Lights and shadows<\/button>/);
  assert.match(gallery, /<summary[^>]*aria-label="More">More/);
  assert.doesNotMatch(gallery, /overflow-x-auto/);
  assert.doesNotMatch(gallery, /<select/);
  assert.equal((gallery.match(/<canvas /g) ?? []).length, mathExamples.length);
  assert.doesNotMatch(gallery, /data-geometry-fps/);
  assert.match(renderPlayground('compose-transform', 'en'), /data-geometry-fps/);
  assert.match(gallery, /#\/en\/lessons\/engine-scene/);
  assert.match(gallery, /assets\/kinetic-garden\/preview\.png/);
  assert.equal((gallery.match(/class="gallery-preview/g) ?? []).length, 24);
  assert.match(gallery, /58 lessons shown/);
  assert.doesNotMatch(gallery, /Try it|À essayer/);
  assert.match(gallery, /#\/en\/playground\/compose-transform/);
});

test('home and gallery reuse the same linked example card', () => {
  const home = renderToStaticMarkup(
    createElement(Home, { locale: 'en', t: (_locale, key) => key }),
  );
  assert.equal((home.match(/class="gallery-preview/g) ?? []).length, 3);
  assert.equal((home.match(/href="#\/en\/playground\//g) ?? []).length, 3);
  assert.doesNotMatch(home, /featured-card/);
});

test('all scenarios produce real 3D triangle geometry from SDK results', () => {
  for (const example of mathExamples) {
    const state = initialState(example.id);
    const geometry = geometryFor(evaluate(example.id, state));
    assert.ok(geometry instanceof Float32Array && geometry.length >= 27, example.id);
    assert.equal(geometry.length % 27, 0, example.id);
  }
});

test('every displayed snippet runs and matches its playground result', async () => {
  const engine = new URL('../site/demos/engine.ts', import.meta.url).href;
  for (const example of mathExamples) {
    const state = initialState(example.id);
    const source = codeFor(example.id, state).replace("'./js/engine.js'", JSON.stringify(engine));
    const actual = (await import(`data:text/javascript,${encodeURIComponent(source)}`)).default;
    const result = evaluate(example.id, state);
    const expected = expectedResultFor(example.id, result);
    if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) < 1e-10, example.id);
    else {
      assert.ok(expected !== undefined, example.id);
      assert.deepEqual(Array.from(actual), Array.from(expected), example.id);
    }
  }
});

test('every scenario calls the engine module', async () => {
  const source = (
    await Promise.all(
      ['evaluate.ts', 'evaluateDetail.ts', 'evaluateAdvanced.ts'].map((file) =>
        readFile(new URL(file, root), 'utf8'),
      ),
    )
  ).join('\n');
  for (const example of mathExamples) {
    assert.ok(example.functions);
    assert.ok(
      example.functions.some((name) => source.includes(name)),
      `${example.id} has no engine call`,
    );
  }
  assert.doesNotMatch(source, /eval\(|new Function/);
});
