import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraLessonDefinitions } from '../docs/js/gallery/cameraLessonDefinitions.js';
import { cameraLessonCode } from '../docs/js/gallery/cameraLessonCode.js';
import { applyCameraLesson, cameraPoseFor } from '../docs/js/gallery/cameraLessonRuntime.js';

const home = { position: [4, 3, 6], target: [0, 1, 0], fov: 50, near: 0.1, far: 100 };
const explorer = { homePose: () => structuredClone(home) };
const initial = (lesson) => Object.fromEntries(lesson.controls.map(({ id, value }) => [id, value]));

test('camera lessons preserve every pose field they do not teach', () => {
  for (const lesson of cameraLessonDefinitions) {
    const pose = cameraPoseFor(explorer, lesson, initial(lesson));
    assert.deepEqual(pose.target, home.target, lesson.id);
    assert.equal(pose.far, home.far, lesson.id);
    if (lesson.mode !== 'fov') assert.equal(pose.fov, home.fov, lesson.id);
    if (lesson.mode !== 'near') assert.equal(pose.near, home.near, lesson.id);
  }
});

test('dolly scales eye-to-target distance and orbit keeps its horizontal radius', () => {
  const dolly = cameraLessonDefinitions.find(({ mode }) => mode === 'dolly'),
    orbit = cameraLessonDefinitions.find(({ mode }) => mode === 'orbit');
  assert.deepEqual(cameraPoseFor(explorer, dolly, { distance: 0.5 }).position, [2, 2, 3]);
  const turned = cameraPoseFor(explorer, orbit, { angle: 90 });
  assert.ok(Math.abs(turned.position[0] - Math.hypot(4, 6)) < 1e-12);
  assert.ok(Math.abs(turned.position[2]) < 1e-12);
});

test('every camera lesson calls the public setPose API and shows complete setup code', () => {
  for (const lesson of cameraLessonDefinitions) {
    let actual;
    applyCameraLesson({ ...explorer, setPose: (pose) => (actual = pose) }, lesson, initial(lesson));
    assert.deepEqual(actual, cameraPoseFor(explorer, lesson, initial(lesson)));
    const code = cameraLessonCode(lesson, initial(lesson));
    assert.match(code, /createExplorer/);
    assert.match(code, /explorer\.homePose\(\)/);
    assert.match(code, /explorer\.setPose\(pose\)/);
  }
});
