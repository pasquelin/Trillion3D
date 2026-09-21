import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { rendererLessons, rendererInitialState } from '../site/lessons/rendererLessons.ts';
import { rendererCodeFor } from '../site/lessons/rendererLessonCode.ts';
import { syncRendererState } from '../site/lessons/syncRendererState.ts';
import { galleryRoadmapEntry, relatedReadyLesson } from '../site/app/gallery/roadmapRelated.ts';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };
import { transformSync } from 'esbuild';
import { loadReactComponents } from './docs/render-react.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { Playground } = await loadReactComponents('site/app/gallery/index.tsx');

test('every integrated renderer lesson emits complete parseable host code', () => {
  for (const lesson of rendererLessons) {
    const code = rendererCodeFor(lesson, rendererInitialState(lesson));
    assert.doesNotThrow(() => transformSync(code, { format: 'esm' }), lesson.id);
    assert.match(code, /from 'web-geometry'[\s\S]*createExplorer\(canvas/);
    assert.match(code, /backends: \[webgpuPagesBackend\]/);
    assert.match(code, /pixelRatio: window\.devicePixelRatio/);
    assert.match(code, /new ResizeObserver/);
    assert.match(code, /await explorer.awaitPages\(\)/);
    assert.match(code, /interactive: false/);
    assert.match(code, /explorer\.dispose\(\)/);
    assert.ok(code.indexOf('await explorer.awaitPages()') < code.indexOf('explorer.render()'));
    assert.ok(code.includes(lesson.manifest), `${lesson.id} uses its displayed manifest`);
    if (lesson.kind === 'offline') assert.ok(code.includes(lesson.manifest));
    assert.match(code, new RegExp(`importedLights: ${lesson.importedLights}`));
    if (lesson.sceneLight) assert.match(code, /id: 'scene'.*kind: 'directional'/);
    if (lesson.sceneFill) assert.match(code, /id: 'scene-fill'.*castsShadow: false/);
  }
});

test('live renderer lessons use diverse original scenes and matching captures', () => {
  const live = rendererLessons.filter((lesson) => lesson.kind !== 'offline');
  assert.equal(live.length, 17);
  const scenes = new Map();
  for (const lesson of live)
    scenes.set(lesson.manifest, [...(scenes.get(lesson.manifest) ?? []), lesson.id]);
  assert.deepEqual(
    [...scenes.values()].filter((ids) => ids.length > 1),
    [],
  );
  for (const lesson of live) {
    assert.match(
      lesson.manifest,
      /^\.\/assets\/(gallery\/(offline|shadow-theatre|signature-architecture)|kinetic-garden)\//,
    );
    assert.equal(lesson.preview, `./assets/gallery/renderer/${lesson.id}.png`);
  }
});

test('the LOD lesson uses a compiled multi-level cache', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'runtime-pixel-error');
  const pointer = JSON.parse(
    await readFile(new URL(`../site/${lesson.manifest.slice(2)}`, import.meta.url), 'utf8'),
  );
  const manifest = JSON.parse(
    await readFile(
      new URL(
        `../site/${lesson.manifest.slice(2).replace('manifest.json', pointer.url)}`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(manifest.simplification, true);
  assert.equal(manifest.selectedTriangles, 91_352);
  assert.deepEqual(lesson.referenceReview.urls, [
    'https://threejs.org/examples/webgl_lod.html',
    'https://threejs.org/examples/webgl_batch_lod_bvh.html',
  ]);
  const code = rendererCodeFor(lesson, rendererInitialState(lesson));
  for (const expected of [
    "manifestUrl: './assets/gallery/signature-architecture/cache/native/full/manifest.json'",
    'backends: [webgpuPagesBackend]',
    'importedLights: true',
    'interactive: false',
    'pixelRatio: window.devicePixelRatio',
    'pixelError: 0',
    'position: [19,13,22]',
    'target: [0,3,0]',
    "explorer.setDiagnostic('beauty')",
  ])
    assert.ok(code.includes(expected), expected);
  assert.doesNotMatch(code, /addLight\(/);

  const proof = JSON.parse(
      await readFile(
        new URL('../site/assets/gallery/proofs/observatory-proof.json', import.meta.url),
        'utf8',
      ),
    ),
    [fine, coarse, restored] = [proof.samples[0], proof.samples[2], proof.samples[3]],
    captures = await Promise.all([
      readFile(new URL('../site/assets/gallery/proofs/observatory-detail-0.png', import.meta.url)),
      readFile(new URL('../site/assets/gallery/proofs/observatory-detail-8.png', import.meta.url)),
    ]);
  assert.deepEqual(proof.resolution, [1600, 1040]);
  assert.equal(proof.dpr, 2);
  assert.deepEqual(proof.camera, lesson.initialPose);
  assert.equal(fine.selected, 91_352);
  assert.equal(coarse.selected, 7_132);
  assert.equal(restored.selected, 91_352);
  assert.equal(restored.restoredDifference, 0);
  assert.equal(restored.stillDifference, 0);
  assert.notDeepEqual(captures[0], captures[1]);
});

test('renderer badges link only to documented API entries', () => {
  const render = (id) => renderToStaticMarkup(createElement(Playground, { id, locale: 'en' }));
  const light = render('point-light-range');
  assert.doesNotMatch(light, /#\/en\/api\/addLight/);
  assert.match(light, />addLight<\/code>/);
  assert.match(render('offline-prism'), /#\/en\/api\/createExplorer/);
});

test('the shadow switch uses its original theatre and keeps direct light in both states', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'shadow-casting-switch'),
    pointer = JSON.parse(
      await readFile(new URL(`../site/${lesson.manifest.slice(2)}`, import.meta.url), 'utf8'),
    ),
    manifest = JSON.parse(
      await readFile(
        new URL(
          `../site/${lesson.manifest.slice(2).replace('manifest.json', pointer.url)}`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
  assert.equal(manifest.sourceTriangles, 26_313);
  assert.equal(lesson.sceneFill, false);
  assert.deepEqual(lesson.referenceReview.urls, [
    'https://threejs.org/examples/webgl_shadowmap.html',
  ]);
  const on = rendererCodeFor(lesson, { shadow: 1 }),
    off = rendererCodeFor(lesson, { shadow: 0 });
  assert.match(on, /intensity: 1800.*castsShadow: true/);
  assert.match(off, /intensity: 1800.*castsShadow: false/);
  const markup = renderToStaticMarkup(createElement(Playground, { id: lesson.id, locale: 'en' }));
  assert.match(markup, /type="checkbox"[^>]*aria-label="Cast shadow"/);
  assert.match(markup, /Cast shadow: Enabled/);
  assert.match(markup, /aria-busy="true"[^>]*class="[^"]*invisible/);
  const [onCapture, offCapture] = await Promise.all([
    readFile(
      new URL('../site/assets/gallery/proofs/shadow-casting-switch-on.png', import.meta.url),
    ),
    readFile(
      new URL('../site/assets/gallery/proofs/shadow-casting-switch-off.png', import.meta.url),
    ),
  ]);
  assert.notDeepEqual(onCapture, offCapture);
});

test('binary lesson controls render as accessible toggles', () => {
  const markup = renderToStaticMarkup(
    createElement(Playground, { id: 'runtime-pixel-error', locale: 'en' }),
  );
  assert.match(markup, /<input[^>]*type="checkbox"[^>]*aria-label="Show detail levels"/);
  assert.match(markup, /#38bdf8[^>]*><\/span>Exact detail/);
  assert.match(markup, /#f59e0b[^>]*><\/span>Coarse fallback/);
  assert.doesNotMatch(markup, /<input[^>]*type="range"[^>]*aria-label="Show detail levels"/);
});

test('partial reference topics link to qualified original offline lessons', () => {
  for (const id of [
    'webgl_marchingcubes',
    'webgl_modifier_simplifier',
    'webgl_geometry_spline_editor',
  ]) {
    const related = relatedReadyLesson({ id });
    const lesson = rendererLessons.find((entry) => entry.id === related);
    assert.equal(lesson.referenceCoverage[id], 'partial');
    assert.equal(lesson.coverage, 'offline-analogue');
  }
});

test('full reference topics become ready links to their actual lesson', () => {
  const ready = roadmap.entries
    .map(galleryRoadmapEntry)
    .filter(({ readyLessonId }) => readyLessonId);
  assert.equal(ready.length, 12);
  for (const entry of ready) {
    const lesson = rendererLessons.find(({ id }) => id === entry.readyLessonId);
    assert.equal(lesson.referenceCoverage[entry.id], 'full');
    assert.equal(entry.status, 'ready');
    assert.equal(entry.preview, lesson.preview);
  }
});
test('a control change during setup reaches the mounted renderer', async () => {
  const initial = { intensity: 60 },
    latest = { intensity: 80 },
    updates = [],
    runtime = { update: async (state) => updates.push(state) };
  await syncRendererState(runtime, initial, initial);
  await syncRendererState(runtime, initial, latest);
  assert.deepEqual(updates, [latest]);
});
