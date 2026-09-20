import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererLessons, rendererInitialState } from '../docs/js/gallery/rendererLessons.js';
import { rendererCodeFor } from '../docs/js/gallery/rendererLessonCode.js';
import { galleryRoadmapEntry, relatedReadyLesson } from '../docs/react/gallery/roadmapRelated.js';
import roadmap from '../docs/data/gallery-roadmap.json' with { type: 'json' };
import { transformSync } from 'esbuild';

test('every integrated renderer lesson emits complete parseable host code', () => {
  for (const lesson of rendererLessons) {
    const code = rendererCodeFor(lesson, rendererInitialState(lesson));
    assert.doesNotThrow(() => transformSync(code, { format: 'esm' }), lesson.id);
    assert.match(code, /document.querySelector\('canvas'\)/);
    assert.match(code, /await explorer.awaitPages\(\)/);
    assert.match(code, /ResizeObserver/);
    assert.match(code, /controls\?\.dispose/);
    assert.ok(
      code.indexOf('await explorer.awaitPages()') < code.indexOf('controls = explorer.controls()'),
    );
    if (lesson.kind === 'offline') assert.ok(code.includes(lesson.manifest));
    if (['lod', 'memory'].includes(lesson.kind)) assert.match(code, /importedLights: true/);
  }
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
