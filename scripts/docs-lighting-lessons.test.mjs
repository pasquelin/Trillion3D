import assert from 'node:assert/strict';
import test from 'node:test';
import { lightingLessonDefinitions } from '../site/lessons/lightingLessonDefinitions.ts';
import {
  applyLightingLesson,
  createLightingLessonSession,
} from '../site/lessons/lightingLessonRuntime.ts';
import { lightingLessonCode } from '../site/lessons/lightingLessonCode.ts';

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
  assert.equal(lightingLessonDefinitions.length, 6);
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
  const lesson = lightingLessonDefinitions.find(({ kind }) => kind === 'light-lifecycle'),
    session = createLightingLessonSession(),
    { calls, explorer } = recorder();
  applyLightingLesson(explorer, lesson, { enabled: 1 }, session);
  applyLightingLesson(explorer, lesson, { enabled: 0 }, session);
  applyLightingLesson(explorer, lesson, { enabled: 0 }, session);
  applyLightingLesson(explorer, lesson, { enabled: 1 }, session);
  assert.equal(calls.filter(([name]) => name === 'removeLight').length, 1);
  assert.equal(calls.filter(([name]) => name === 'addLight').length, 2);
});

test('the ring lesson keeps its lamps by id, removes only those beyond the count, in two colours', () => {
  const lesson = lightingLessonDefinitions.find(({ kind }) => kind === 'many-lights'),
    session = createLightingLessonSession(),
    { calls, explorer } = recorder();
  applyLightingLesson(explorer, lesson, { count: 6 }, session);
  applyLightingLesson(explorer, lesson, { count: 3 }, session);
  applyLightingLesson(explorer, lesson, { count: 4 }, session);
  const names = (name) => calls.filter(([called]) => called === name);
  assert.equal(names('addLight').length, 7, 'six lamps, then the fourth again');
  assert.equal(names('setLight').length, 6, 'three kept lamps, updated twice');
  assert.deepEqual(
    names('removeLight').map(([, id]) => id),
    ['ring-3', 'ring-4', 'ring-5'],
  );
  const colours = names('addLight').map(([, light]) => light.color.join());
  assert.equal(new Set(colours).size, 2, 'two colours in turn');
  assert.notEqual(colours[0], colours[1]);
  assert.match(lightingLessonCode(lesson, { count: 2 }), /'ring-1'/);
  assert.doesNotMatch(lightingLessonCode(lesson, { count: 2 }), /'ring-2'/);
});
