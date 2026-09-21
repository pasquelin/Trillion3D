import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';
import { codeFor } from '../site/lessons/code.ts';
import { evaluate } from '../site/lessons/evaluate.ts';
import { geometryFor } from '../site/lessons/sceneGeometry.ts';
import { draw, legendAnchors } from '../site/lessons/draw.ts';
import { initialState } from '../site/lessons/scenarios.ts';
import { examples } from '../site/content/catalog.ts';
import { rendererLessons } from '../site/lessons/rendererLessons.ts';

const root = new URL('../site/lessons/', import.meta.url);
const { Gallery } = await loadReactComponents('site/app/gallery/Gallery.tsx');
const { Playground } = await loadReactComponents('site/app/gallery/Playground.tsx');
const { ExampleCard } = await loadReactComponents('site/app/gallery/ExampleCard.tsx');
const { Home } = await loadReactComponents('site/app/portal/Home.tsx');
const { CodeBlock } = await loadReactComponents('site/app/components/CodeBlock.tsx');
const renderGallery = (locale) => renderToStaticMarkup(createElement(Gallery, { locale }));
const renderPlayground = (id, locale) =>
  renderToStaticMarkup(createElement(Playground, { id, locale }));
const mathExamples = examples.filter(({ renderer }) => !renderer);

test('gallery exposes bilingual math and public renderer lessons', () => {
  assert.equal(examples.length, 57);
  assert.equal(rendererLessons.length, 41);
  assert.equal(new Set(examples.map(({ id }) => id)).size, examples.length);
  for (const example of examples) {
    assert.ok(example.title.en && example.title.fr);
    assert.ok(example.description.en && example.description.fr);
    assert.ok(example.functions.length > 0);
  }
  assert.match(renderGallery('fr'), /Décisions du frustum/);
  assert.match(renderPlayground('dot-product', 'en'), /Dot product as alignment/);
  assert.match(renderPlayground('dot-product', 'fr'), /aria-label=/);
  assert.match(renderPlayground('dot-product', 'en'), /<h1 class=/);
  assert.match(renderPlayground('dot-product', 'en'), /Copy code/);
  assert.match(renderPlayground('point-light-range', 'fr'), /data-renderer-playground/);
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
  class SvgNode {
    children = [];
    setAttribute(name, value) {
      assert.doesNotMatch(String(value), /NaN|undefined/, name);
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
  }
  const previous = globalThis.document;
  globalThis.document = { createElementNS: () => new SvgNode() };
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
  assert.match(gallery, />Animation<\/button>/);
  assert.match(gallery, />Lights and shadows<\/button>/);
  assert.match(gallery, /<summary[^>]*aria-label="More">More/);
  assert.doesNotMatch(gallery, /overflow-x-auto/);
  assert.doesNotMatch(gallery, /<select/);
  assert.equal((gallery.match(/<canvas /g) ?? []).length, mathExamples.length);
  assert.doesNotMatch(gallery, /data-geometry-fps/);
  assert.match(renderPlayground('compose-transform', 'en'), /data-geometry-fps/);
  assert.match(gallery, /#\/en\/examples\/engine-scene/);
  assert.match(gallery, /assets\/kinetic-garden\/preview\.png/);
  assert.equal((gallery.match(/class="gallery-preview/g) ?? []).length, 24);
  assert.match(gallery, /665 results shown · 58 ready lessons in the full gallery/);
  assert.doesNotMatch(gallery, /data-geometry-3d="webgl_/);
  assert.doesNotMatch(gallery, /Try it|À essayer/);
  assert.match(gallery, /#\/en\/playground\/compose-transform/);
});

test('planned lessons stay honest, specific, and link to related ready material', async () => {
  const roadmap = JSON.parse(
    await readFile(new URL('../site/content/gallery-roadmap.json', import.meta.url), 'utf8'),
  );
  assert.equal(roadmap.entries.length, 607);
  for (const locale of ['en', 'fr'])
    assert.equal(new Set(roadmap.entries.map((entry) => entry.title[locale])).size, 607);
  const entry = roadmap.entries.find(({ subject }) => subject === 'camera');
  const card = renderToStaticMarkup(
    createElement(ExampleCard, { example: entry, locale: 'fr', expanded: true, onOpen() {} }),
  );
  assert.match(card, /Plan non exécutable/);
  assert.match(card, /Pourquoi/);
  assert.match(card, /#\/fr\/playground\/perspective/);
  assert.doesNotMatch(card, /contrat public prouvé|prise en charge actuelle/);
  const frenchTitles = roadmap.entries.map((item) => item.title.fr).join('\n');
  assert.match(frenchTitles, /Réfraction/);
  assert.doesNotMatch(frenchTitles, /^Walk$/m);
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
    const expected = {
      'compose-transform': result.points?.[2],
      'matrix-chain': result.point,
      'matrix-inverse': result.identity,
      'reflection-orientation': [result.determinant, result.linear],
      'quaternion-turn': result.direction,
      'normal-transform': result.normal,
      perspective: result.ndc,
      frustum: result.status,
      'dot-product': result.dot,
      'cross-product': result.cross,
      normalize: result.after,
      'box-grow': result.box,
      'sphere-from-box': result.sphere,
      hierarchy: result.point,
      'color-space': [result.screen, result.light],
      'lod-budget': result.error,
    }[example.id];
    if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) < 1e-10, example.id);
    else assert.deepEqual(Array.from(actual), Array.from(expected), example.id);
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
  for (const example of mathExamples)
    assert.ok(
      example.functions.some((name) => source.includes(name)),
      `${example.id} has no engine call`,
    );
  assert.doesNotMatch(source, /eval\(|new Function/);
});
