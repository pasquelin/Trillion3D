import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { rendererLessons, rendererInitialState } from '../docs/js/gallery/rendererLessons.js';
import { rendererCodeFor } from '../docs/js/gallery/rendererLessonCode.js';
import { syncRendererState } from '../docs/js/gallery/syncRendererState.js';
import { galleryRoadmapEntry, relatedReadyLesson } from '../docs/react/gallery/roadmapRelated.js';
import roadmap from '../docs/data/gallery-roadmap.json' with { type: 'json' };
import { transformSync } from 'esbuild';
import { loadReactComponents } from './docs/render-react.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { Playground } = await loadReactComponents('docs/react/gallery/index.jsx');

test('every integrated renderer lesson emits complete parseable host code', () => {
  for (const lesson of rendererLessons) {
    const code = rendererCodeFor(lesson, rendererInitialState(lesson));
    assert.doesNotThrow(() => transformSync(code, { format: 'esm' }), lesson.id);
    assert.match(code, /createExplorer\('garden'/);
    assert.match(code, /await explorer.awaitPages\(\)/);
    assert.match(code, /interactive: true/);
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
  assert.equal(live.length, 15);
  assert.equal(new Set(live.map(({ manifest }) => manifest)).size, live.length);
  for (const lesson of live) {
    assert.match(lesson.manifest, /^\.\/assets\/(gallery\/offline|kinetic-garden)\//);
    assert.equal(lesson.preview, `./assets/gallery/renderer/${lesson.id}.png`);
  }
});

test('the LOD lesson uses a compiled multi-level cache', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'runtime-pixel-error');
  const pointer = JSON.parse(
    await readFile(new URL(`../docs/${lesson.manifest.slice(2)}`, import.meta.url), 'utf8'),
  );
  const manifest = JSON.parse(
    await readFile(
      new URL(
        `../docs/${lesson.manifest.slice(2).replace('manifest.json', pointer.url)}`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(manifest.simplification, true);
  assert.equal(manifest.selectedTriangles, 1_152);
});

test('renderer badges link only to documented API entries', () => {
  const render = (id) => renderToStaticMarkup(createElement(Playground, { id, locale: 'en' }));
  const light = render('point-light-range');
  assert.doesNotMatch(light, /#\/en\/api\/addLight/);
  assert.match(light, />addLight<\/code>/);
  assert.match(render('offline-prism'), /#\/en\/api\/createExplorer/);
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
  assert.equal(ready.length, 9);
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
