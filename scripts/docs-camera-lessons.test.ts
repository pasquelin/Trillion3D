import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraLessonDefinitions } from '../site/lessons/cameraLessonDefinitions.ts';
import { cameraLessonCode } from '../site/lessons/cameraLessonCode.ts';
import { applyCameraLesson, cameraPoseFor } from '../site/lessons/cameraLessonRuntime.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import type { RendererLessonItem } from '../site/lessons/rendererLessonTypes.ts';
import type { CameraPose, World } from '../packages/sdk-browser/src/index.ts';

const home: CameraPose = { position: [4, 3, 6], target: [0, 1, 0], fov: 50 };
const initial = (lesson: RendererLessonItem) =>
  Object.fromEntries(lesson.controls.map(({ id, value }) => [id, value]));
// `applyCameraLesson` only reads/writes `camera`; a real `Camera` stands in for the world,
// which otherwise needs a canvas.
const fakeWorld = (): World => ({ camera: new Camera('perspective') }) as unknown as World;

test('camera lessons preserve every pose field they do not teach', () => {
  for (const lesson of cameraLessonDefinitions) {
    const pose = cameraPoseFor(home, lesson, initial(lesson));
    assert.deepEqual(pose.target, home.target, lesson.id);
    if (lesson.mode !== 'fov') assert.equal(pose.fov, home.fov, lesson.id);
  }
});

test('dolly scales eye-to-target distance and orbit keeps its horizontal radius', () => {
  const dolly = cameraLessonDefinitions.find(({ mode }) => mode === 'dolly'),
    orbit = cameraLessonDefinitions.find(({ mode }) => mode === 'orbit');
  assert(dolly);
  assert(orbit);
  assert.deepEqual(cameraPoseFor(home, dolly, { distance: 0.5 }).position, [2, 2, 3]);
  const turned = cameraPoseFor(home, orbit, { angle: 90 }).position as [number, number, number];
  assert.ok(Math.abs(turned[0] - Math.hypot(4, 6)) < 1e-12);
  assert.ok(Math.abs(turned[2]) < 1e-12);
});

test('every camera lesson drives the public camera API and shows complete setup code', () => {
  for (const lesson of cameraLessonDefinitions) {
    const world = fakeWorld();
    applyCameraLesson(world, home, lesson, initial(lesson));
    if (lesson.mode === 'near') assert.equal(world.camera.near, initial(lesson).near, lesson.id);
    else {
      const pose = cameraPoseFor(home, lesson, initial(lesson));
      assert.deepEqual(world.camera.position.toArray(), pose.position, lesson.id);
      if (pose.fov !== undefined) assert.equal(world.camera.fov, pose.fov, lesson.id);
    }
    const code = cameraLessonCode(lesson, initial(lesson));
    assert.match(code, /createWorld/);
    assert.match(code, /world\.camera\.(?:position\.set\(|fov =|near =)/);
  }
});
