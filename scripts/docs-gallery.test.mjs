import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../docs/js/gallery/', import.meta.url);
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';
const { Gallery, Playground } = await loadReactComponents('docs/react/gallery/index.jsx');
const { Home } = await loadReactComponents('docs/react/portal/Home.jsx');
const { CodeBlock } = await loadReactComponents('docs/react/components/CodeBlock.jsx');
const renderGallery = (locale) => renderToStaticMarkup(createElement(Gallery, { locale }));
const renderPlayground = (id, locale) =>
  renderToStaticMarkup(createElement(Playground, { id, locale }));
const { codeFor } = await import(new URL('code.js', root));
const { evaluate } = await import(new URL('evaluate.js', root));
const { geometryFor } = await import(new URL('sceneGeometry.js', root));
const { legendAnchors } = await import(new URL('draw.js', root));
const { initialState } = await import(new URL('scenarios.js', root));
const { examples } = await import(new URL('catalog.js', root));
const { apiScenario } = await import(new URL('apiScenario.js', root));

test('gallery exposes sixteen bilingual, interactive examples', () => {
  assert.equal(examples.length, 16);
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

test('gallery renders visual, searchable cards and the real engine scene', () => {
  const gallery = renderGallery('en');
  assert.match(gallery, /type="search"/);
  assert.match(gallery, /aria-pressed="true"/);
  assert.match(gallery, /tabs tabs-box bg-base-200/);
  assert.equal((gallery.match(/<canvas /g) ?? []).length, examples.length);
  assert.doesNotMatch(gallery, /data-geometry-fps/);
  assert.match(renderPlayground('compose-transform', 'en'), /data-geometry-fps/);
  assert.match(gallery, /#\/en\/examples\/engine-scene/);
  assert.match(gallery, /assets\/kinetic-garden\/preview\.png/);
  assert.equal((gallery.match(/class="gallery-preview/g) ?? []).length, examples.length + 1);
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
  for (const example of examples) {
    const state = initialState(example.id);
    const geometry = geometryFor(example.id, evaluate(example.id, state));
    assert.ok(geometry instanceof Float32Array && geometry.length >= 27, example.id);
    assert.equal(geometry.length % 27, 0, example.id);
  }
});

test('every displayed snippet runs and matches its playground result', async () => {
  const engine = new URL('../docs/js/engine.js', import.meta.url).href;
  for (const example of examples) {
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

test('API functions resolve to a visual example', () => {
  assert.equal(apiScenario('crossVector3'), 'cross-product');
  assert.equal(apiScenario('missing'), undefined);
});

test('visible engine results follow the selected language', () => {
  const french = evaluate('frustum', { x: 0, depth: 4, fov: 55 }, 'fr');
  assert.equal(french.value, 'dedans');
});

test('every scenario calls the generated engine module', async () => {
  const source = (
    await Promise.all(
      ['evaluate.js', 'evaluateDetail.js', 'evaluateAdvanced.js'].map((file) =>
        readFile(new URL(file, root), 'utf8'),
      ),
    )
  ).join('\n');
  for (const example of examples)
    assert.ok(
      example.functions.some((name) => source.includes(name)),
      `${example.id} has no engine call`,
    );
  assert.doesNotMatch(source, /eval\(|new Function/);
});
