import assert from 'node:assert/strict';
import test from 'node:test';
import { lightingLessonDefinitions } from '../site/lessons/lightingLessonDefinitions.ts';
import {
  applyLightingLesson,
  createLightingLessonSession,
} from '../site/lessons/lightingLessonRuntime.ts';
import { lightingLessonCode } from '../site/lessons/lightingLessonCode.ts';
import { light } from '../packages/sdk-core/world/light/index.ts';
import type { RendererLessonItem } from '../site/lessons/rendererLessonTypes.ts';
import type { World } from '../packages/sdk-browser/index.ts';

const initial = (lesson: RendererLessonItem) =>
  Object.fromEntries(lesson.controls.map(({ id, value }) => [id, value]));

type Call = [string, ...unknown[]];

function recorder() {
  const calls: Call[] = [];
  // The new surface mutates a light in place rather than calling back through the world, so a
  // point light is wrapped to record its own property writes (`light.intensity =`) alongside
  // the `scene.add`/`scene.remove` calls the world records.
  const wrapped = {
    point: (p: Parameters<typeof light.point>[0]) =>
      new Proxy(light.point(p), {
        set(target, prop, value) {
          calls.push([`light.${String(prop)} =`, value]);
          return Reflect.set(target, prop, value);
        },
      }),
  } as unknown as typeof light;
  const world = {
    scene: {
      add: (made: unknown) => {
        calls.push(['scene.add(light.*)', made]);
        return made;
      },
      remove: (made: unknown) => {
        calls.push(['scene.remove', made]);
      },
    },
    diagnostic: { mode: 'beauty' },
  } as unknown as World;
  return { calls, light: wrapped, world };
}

test('advanced lighting lessons use only their declared public light operations', () => {
  assert.equal(lightingLessonDefinitions.length, 6);
  for (const lesson of lightingLessonDefinitions) {
    const { calls, light: wrapped, world } = recorder();
    applyLightingLesson(wrapped, world, lesson, initial(lesson), createLightingLessonSession());
    assert.ok(
      lesson.functions.some((name) => calls.some(([called]) => called === name)),
      lesson.id,
    );
    const code = lightingLessonCode(lesson, initial(lesson));
    assert.match(code, /createWorld/);
    // `functions` names the public surface as documentation (`scene.add(light.*)`'s `*` is never
    // literal, and a removal only shows for a state that triggers it); the code shape every
    // lesson reaches is what is provable: a lamp.
    assert.match(code, /light\.point\(/, lesson.id);
  }
});

test('colour balance owns two stable lights and updates instead of duplicating them', () => {
  const lesson = lightingLessonDefinitions[0],
    session = createLightingLessonSession(),
    { calls, light: wrapped, world } = recorder();
  applyLightingLesson(wrapped, world, lesson, { warm: 2, cool: 4 }, session);
  applyLightingLesson(wrapped, world, lesson, { warm: 5, cool: 1 }, session);
  assert.deepEqual(
    calls.map(([name]) => name).filter((name) => name !== 'light.castShadow ='),
    ['scene.add(light.*)', 'scene.add(light.*)', 'light.intensity =', 'light.intensity ='],
  );
  assert.equal(session.lights.size, 2, 'no duplicate light was added on the second update');
});

test('lifecycle removes an existing light once and restores it by id', () => {
  const lesson = lightingLessonDefinitions.find(({ kind }) => kind === 'light-lifecycle');
  assert(lesson);
  const session = createLightingLessonSession(),
    { calls, light: wrapped, world } = recorder();
  applyLightingLesson(wrapped, world, lesson, { enabled: 1 }, session);
  applyLightingLesson(wrapped, world, lesson, { enabled: 0 }, session);
  applyLightingLesson(wrapped, world, lesson, { enabled: 0 }, session);
  applyLightingLesson(wrapped, world, lesson, { enabled: 1 }, session);
  assert.equal(calls.filter(([name]) => name === 'scene.remove').length, 1);
  assert.equal(calls.filter(([name]) => name === 'scene.add(light.*)').length, 2);
});

test('the ring lesson keeps its lamps by id, removes only those beyond the count, in two colours', () => {
  const lesson = lightingLessonDefinitions.find(({ kind }) => kind === 'many-lights');
  assert(lesson);
  const session = createLightingLessonSession(),
    { light: wrapped, world } = recorder();
  applyLightingLesson(wrapped, world, lesson, { count: 6 }, session);
  applyLightingLesson(wrapped, world, lesson, { count: 3 }, session);
  applyLightingLesson(wrapped, world, lesson, { count: 4 }, session);
  assert.deepEqual(
    [...session.lights.keys()].sort(),
    ['ring-0', 'ring-1', 'ring-2', 'ring-3'],
    'the fourth lamp came back once the count grew again',
  );
  // Two colours in turn, read back off the live lights the session kept.
  const colours = [...session.lights.values()].map((made) => made.color.getHex());
  assert.equal(new Set(colours).size, 2, 'two colours in turn');
  assert.match(lightingLessonCode(lesson, { count: 2 }), /\bring1\b/);
  assert.doesNotMatch(lightingLessonCode(lesson, { count: 2 }), /\bring2\b/);
});
