import assert from 'node:assert/strict';
import test from 'node:test';
import { rendererInitialState, rendererLessons } from '../site/lessons/rendererLessons.ts';
import { applyRendererLesson } from '../site/lessons/rendererLessonRuntime.ts';
import { requiredLesson } from './docs/lesson-manifest.ts';
import { light } from '../packages/sdk-core/world/light/index.ts';
import type { Light, World } from '../packages/sdk-browser/index.ts';

type RecordedCall = [string, ...unknown[]];

// The new surface mutates a light in place and writes world properties directly, rather than
// calling back through a session object: a light is wrapped to record its own property writes,
// and `world` records what a page would otherwise observe by reading the property back.
function recorder() {
  const calls: RecordedCall[] = [];
  const wrap = <T extends object>(made: T): T =>
    new Proxy(made, {
      set(target, prop, value) {
        calls.push([`light.${String(prop)} =`, value]);
        return Reflect.set(target, prop, value);
      },
    });
  const wrappedLight = {
    point: (p: Parameters<typeof light.point>[0]) => wrap(light.point(p)),
    spot: (p: Parameters<typeof light.spot>[0]) => wrap(light.spot(p)),
    directional: (p: Parameters<typeof light.directional>[0]) => wrap(light.directional(p)),
  } as unknown as typeof light;
  let exposure = 1,
    pixelError = 0,
    diagnosticMode = 'beauty',
    geometryPool = 0;
  const world = {
    scene: {
      add: (made: unknown) => {
        calls.push(['scene.add(light.*)', made]);
        return made;
      },
      remove: (made: unknown) => calls.push(['scene.remove', made]),
    },
    get exposure() {
      return exposure;
    },
    set exposure(value: number) {
      exposure = value;
      calls.push(['world.exposure', value]);
    },
    get pixelError() {
      return pixelError;
    },
    set pixelError(value: number) {
      pixelError = value;
      calls.push(['world.pixelError', value]);
    },
    diagnostic: {
      get mode() {
        return diagnosticMode;
      },
      set mode(value: string) {
        diagnosticMode = value;
        calls.push(['world.diagnostic.mode', value]);
      },
    },
    budget: {
      get geometryPool() {
        return geometryPool;
      },
      set geometryPool(value: number) {
        geometryPool = value;
        calls.push(['world.budget.geometryPool', value]);
      },
    },
  };
  return { calls, light: wrappedLight, world: world as unknown as World };
}

test('each renderer lesson reaches its documented public engine operation', () => {
  for (const lesson of rendererLessons.filter((item) => !item.runtime && item.kind !== 'offline')) {
    const { calls, light: wrapped, world } = recorder();
    applyRendererLesson(wrapped, world, lesson, rendererInitialState(lesson), {
      current: undefined,
    });
    assert.ok(
      lesson.functions?.some((name) => calls.some(([called]) => called === name)),
      lesson.id,
    );
  }
});

test('a light update mutates the existing light instead of adding a duplicate', () => {
  const lesson = requiredLesson(({ id }) => id === 'point-light-range');
  const state = rendererInitialState(lesson),
    session: { current: Light | undefined } = { current: undefined },
    { calls, light: wrapped, world } = recorder();
  applyRendererLesson(wrapped, world, lesson, state, session);
  const first = session.current;
  applyRendererLesson(wrapped, world, lesson, { ...state, range: 9 }, session);
  assert.equal(session.current, first, 'the same light instance is kept, not replaced');
  assert.equal(calls.filter(([name]) => name === 'scene.add(light.*)').length, 1);
  assert.equal(first?.distance, 9);
});

test('budget values are converted from the displayed MiB unit', () => {
  const lesson = requiredLesson(({ id }) => id === 'runtime-memory-budget');
  const { calls, light: wrapped, world } = recorder();
  applyRendererLesson(wrapped, world, lesson, { geometryMiB: 20 }, { current: undefined });
  assert.deepEqual(calls, [['world.budget.geometryPool', 20 * 1024 * 1024]]);
});
