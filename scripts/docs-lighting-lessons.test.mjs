import assert from 'node:assert/strict';
import test from 'node:test';
import { lightingLessonDefinitions } from '../docs/js/gallery/lightingLessonDefinitions.js';
import {
  applyLightingLesson,
  createLightingLessonSession,
} from '../docs/js/gallery/lightingLessonRuntime.js';
import { lightingLessonCode } from '../docs/js/gallery/lightingLessonCode.js';

const initial = (lesson) => Object.fromEntries(lesson.controls.map(({ id, value }) => [id, value]));

function recorder() {
  const calls = [];
  return {
    calls,
    explorer: new Proxy(
      {},
      {
        get:
          (_target, name) =>
          (...args) =>
            calls.push([name, ...args]),
      },
    ),
  };
}

test('advanced lighting lessons use only their declared public light operations', () => {
  assert.equal(lightingLessonDefinitions.length, 5);
  for (const lesson of lightingLessonDefinitions) {
    const { calls, explorer } = recorder();
    applyLightingLesson(explorer, lesson, initial(lesson), createLightingLessonSession());
    assert.ok(
      lesson.functions.some((name) => calls.some(([called]) => called === name)),
      lesson.id,
    );
    const code = lightingLessonCode(lesson, initial(lesson));
    assert.match(code, /createExplorer/);
    assert.ok(
      lesson.functions.some((name) => code.includes(name)),
      lesson.id,
    );
  }
});

test('colour balance owns two stable lights and updates instead of duplicating them', () => {
  const lesson = lightingLessonDefinitions[0],
    session = createLightingLessonSession(),
    { calls, explorer } = recorder();
  applyLightingLesson(explorer, lesson, { warm: 2, cool: 4 }, session);
  applyLightingLesson(explorer, lesson, { warm: 5, cool: 1 }, session);
  assert.deepEqual(
    calls.map(([name]) => name),
    ['addLight', 'addLight', 'setLight', 'setLight'],
  );
});

test('lifecycle removes an existing light once and restores it by id', () => {
  const lesson = lightingLessonDefinitions.at(-1),
    session = createLightingLessonSession(),
    { calls, explorer } = recorder();
  applyLightingLesson(explorer, lesson, { enabled: 1 }, session);
  applyLightingLesson(explorer, lesson, { enabled: 0 }, session);
  applyLightingLesson(explorer, lesson, { enabled: 0 }, session);
  applyLightingLesson(explorer, lesson, { enabled: 1 }, session);
  assert.equal(calls.filter(([name]) => name === 'removeLight').length, 1);
  assert.equal(calls.filter(([name]) => name === 'addLight').length, 2);
});
