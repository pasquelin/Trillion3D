import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  Camera,
  Scene,
  geometry,
  light,
  material,
  math,
  object,
  type World,
} from '../packages/sdk-browser/src/index.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';
import { runExampleModule } from './docs/examples/capture.ts';
import type { Intersection } from '../packages/sdk-core/src/world/object/raycast.ts';

type Values = { highlightEnabled: boolean };

test('hover highlights one filtered part and restores it on transitions and cleanup', async () => {
  const html = await readFile(
    new URL('../site/examples/hover-to-highlight.html', import.meta.url),
    'utf8',
  );
  const listeners = new Map<string, EventListener>();
  const canvas = {
    clientWidth: 800,
    clientHeight: 500,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
  } as HTMLCanvasElement;
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const camera = new Camera('perspective');
  let hit: Intersection | null = null;
  let filter: readonly object[] | undefined;
  let values = {} as Values;
  let change = (_next: Values, _key?: keyof Values) => {};
  let invalidations = 0;
  let disposed = 0;
  let pagehide: EventListener | undefined;
  const raycast = ((_: unknown, options?: { objects?: readonly object[] }) => {
    filter = options?.objects;
    return hit;
  }) as World['raycast'];
  const world = {
    scene,
    camera,
    canvas,
    controls: { target: math.vector3() },
    raycast,
    invalidate() {
      invalidations++;
    },
    dispose() {
      disposed++;
    },
  } satisfies Pick<World, 'scene' | 'camera' | 'canvas' | 'raycast' | 'invalidate' | 'dispose'> & {
    controls: Pick<World['controls'], 'target'>;
  };
  const previous = globalThis.addEventListener,
    previousFrame = globalThis.requestAnimationFrame;
  globalThis.addEventListener = ((type: string, listener: EventListener) => {
    if (type === 'pagehide') pagehide = listener;
  }) as typeof globalThis.addEventListener;
  // The page rays once a frame: frames run when the test flushes them.
  const frames: FrameRequestCallback[] = [];
  const flush = () => frames.splice(0).forEach((callback) => callback(0));
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  try {
    await runExampleModule(html, {
      engine: {
        createWorld: () => world,
        geometry,
        material,
        object,
        light,
        math,
      },
      kit: {
        controls(specs: Record<string, ControlSpec>, callback: typeof change, watched: unknown) {
          assert.equal(watched, world);
          values = describe(specs).values as Values;
          change = callback;
          callback(values);
          return values;
        },
      },
    });

    type Part = ReturnType<typeof object.mesh>;
    const parts = scene.children.filter(
      (child) => 'material' in child && child.name !== 'floor',
    ) as Part[];
    assert.equal(parts.length, 7);
    assert.deepEqual(values, { highlightEnabled: true });
    const [first, second] = parts as [Part, Part];
    const paint = (part: Part) => {
      const matter = part.material as ReturnType<typeof material.meshStandard>;
      return [matter.color.getHex(), matter.emissive.getHex()];
    };
    const hitOn = (part: Part): Intersection => ({
      object: part,
      point: math.vector3(),
      normal: math.vector3(0, 1, 0),
      distance: 1,
      face: -1,
    });
    const original = parts.map(paint);
    const move = listeners.get('pointermove');
    const leave = listeners.get('pointerleave');
    assert.ok(move && leave);
    const over = (part: Part | null, buttons = 0) => {
      hit = part && hitOn(part);
      move({ offsetX: 23, offsetY: 41, buttons } as unknown as Event);
      flush();
    };

    over(first);
    assert.equal(filter?.length, parts.length, 'raycast receives only the cart parts');
    assert.ok(filter?.every((part, at) => part === parts[at]));
    assert.notDeepEqual(paint(first), original[0]);

    over(second);
    assert.deepEqual(paint(first), original[0]);
    over(null);
    assert.deepEqual(paint(second), original[1]);
    over(first, 1);
    assert.deepEqual(paint(first), original[0], 'an orbit drag highlights nothing');

    over(first);
    leave(new Event('pointerleave'));
    assert.deepEqual(paint(first), original[0]);
    hit = hitOn(second);
    move({ offsetX: 23, offsetY: 41, buttons: 0 } as unknown as Event);
    leave(new Event('pointerleave'));
    flush();
    assert.deepEqual(
      paint(second),
      original[1],
      'a frame queued before leaving highlights nothing',
    );
    over(second);
    values.highlightEnabled = false;
    change(values, 'highlightEnabled');
    assert.deepEqual(paint(second), original[1]);
    over(first);
    assert.deepEqual(paint(first), original[0], 'switched off, hovering highlights nothing');
    assert.ok(invalidations >= 6);

    assert.ok(pagehide);
    pagehide(new Event('pagehide'));
    assert.equal(disposed, 1);
  } finally {
    globalThis.addEventListener = previous;
    globalThis.requestAnimationFrame = previousFrame;
  }
});
