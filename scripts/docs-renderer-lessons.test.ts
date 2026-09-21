import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererInitialState, rendererLessons } from '../site/lessons/rendererLessons.ts';
import { applyRendererLesson } from '../site/lessons/rendererLessonRuntime.ts';
import { requiredLesson } from './docs/lesson-manifest.ts';
import type { Explorer } from '../packages/sdk-browser/index.ts';

type RecordedCall = [PropertyKey, ...unknown[]];

function recorder() {
  const calls: RecordedCall[] = [];
  return {
    calls,
    // `applyRendererLesson` only ever calls named methods and reads the resolved promise;
    // the Proxy answers any of them, so casting from `{}` (compatible with any object shape)
    // stands in for modelling the whole `Explorer` surface.
    explorer: new Proxy(
      {},
      {
        get:
          (_target, name) =>
          (...args: unknown[]) => {
            calls.push([name, ...args]);
            return Promise.resolve({});
          },
      },
    ) as Explorer,
  };
}

test('each renderer lesson reaches its documented public engine operation', async () => {
  for (const lesson of rendererLessons.filter((item) => !item.runtime && item.kind !== 'offline')) {
    const { calls, explorer } = recorder();
    await applyRendererLesson(explorer, lesson, rendererInitialState(lesson), { value: false });
    assert.ok(
      lesson.functions?.some((name) => calls.some(([called]) => called === name)),
      lesson.id,
    );
  }
});

test('a light update mutates the existing light instead of adding a duplicate', async () => {
  const lesson = requiredLesson(({ id }) => id === 'point-light-range');
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
  const payload = calls[1][2];
  assert.ok(typeof payload === 'object' && payload !== null);
  assert.equal((payload as Record<string, unknown>).range, 9);
  assert.equal('id' in payload, false);
});

test('budget values are converted from the displayed MiB unit', async () => {
  const lesson = requiredLesson(({ id }) => id === 'runtime-memory-budget');
  const { calls, explorer } = recorder();
  await applyRendererLesson(explorer, lesson, { geometryMiB: 20 }, { value: false });
  assert.deepEqual(calls, [['setMemoryBudgets', { geometryPoolBytes: 20 * 1024 * 1024 }]]);
});
