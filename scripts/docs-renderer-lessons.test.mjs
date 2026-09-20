import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererInitialState, rendererLessons } from '../docs/js/gallery/rendererLessons.js';
import { applyRendererLesson } from '../docs/js/gallery/rendererLessonRuntime.js';

function recorder() {
  const calls = [];
  return {
    calls,
    explorer: new Proxy(
      {},
      {
        get:
          (_target, name) =>
          (...args) => {
            calls.push([name, ...args]);
            return Promise.resolve({});
          },
      },
    ),
  };
}

test('each renderer lesson reaches its documented public engine operation', async () => {
  for (const lesson of rendererLessons.filter((item) => !item.runtime && item.kind !== 'offline')) {
    const { calls, explorer } = recorder();
    await applyRendererLesson(explorer, lesson, rendererInitialState(lesson), { value: false });
    assert.ok(
      lesson.functions.some((name) => calls.some(([called]) => called === name)),
      lesson.id,
    );
  }
});

test('a light update mutates the existing light instead of adding a duplicate', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'point-light-range');
  const state = rendererInitialState(lesson),
    added = { value: false },
    { calls, explorer } = recorder();
  await applyRendererLesson(explorer, lesson, state, added);
  await applyRendererLesson(explorer, lesson, { ...state, range: 9 }, added);
  assert.deepEqual(
    calls.map(([name]) => name),
    ['addLight', 'setLight'],
  );
  assert.equal(calls[1][1], 'lesson');
  assert.equal(calls[1][2].range, 9);
  assert.equal('id' in calls[1][2], false);
});

test('budget values are converted from the displayed MiB unit', async () => {
  const lesson = rendererLessons.find(({ id }) => id === 'runtime-memory-budget');
  const { calls, explorer } = recorder();
  await applyRendererLesson(
    explorer,
    lesson,
    { geometryMiB: 20, textureMiB: 64 },
    { value: false },
  );
  assert.deepEqual(calls, [
    [
      'setMemoryBudgets',
      { geometryPoolBytes: 20 * 1024 * 1024, texturePoolBytes: 64 * 1024 * 1024 },
    ],
  ]);
});
