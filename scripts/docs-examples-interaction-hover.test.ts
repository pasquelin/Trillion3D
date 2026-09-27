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
  let hit: ReturnType<World['raycast']> = null;
  let filter: readonly object[] | undefined;
  let values = {} as Values;
  let change = (_next: Values, _key?: keyof Values) => {};
  let invalidations = 0;
  let disposed = 0;
  let pagehide: EventListenerOrEventListenerObject | undefined;
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
  const previous = globalThis.addEventListener;
  globalThis.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'pagehide') pagehide = listener;
  }) as typeof globalThis.addEventListener;
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

    const parts = scene.children.filter((child) => 'material' in child);
    assert.equal(parts.length, 5);
    assert.deepEqual(values, { highlightEnabled: true });
    const [first, second] = parts as ReturnType<typeof object.mesh>[];
    const original = parts.map((part) => {
      const mesh = part as ReturnType<typeof object.mesh>;
      return [mesh.material.color.getHex(), mesh.material.emissive.getHex()];
    });
    const move = listeners.get('pointermove');
    const leave = listeners.get('pointerleave');
    assert.ok(move && leave);

    hit = { object: first } as NonNullable<typeof hit>;
    move({ offsetX: 23, offsetY: 41 } as unknown as Event);
    assert.equal(filter?.length, parts.length, 'raycast receives only the cart parts');
    assert.ok(filter?.every((part, at) => part === parts[at]));
    assert.notDeepEqual(
      [first.material.color.getHex(), first.material.emissive.getHex()],
      original[0],
    );

    hit = { object: second } as NonNullable<typeof hit>;
    move({ offsetX: 40, offsetY: 52 } as unknown as Event);
    assert.deepEqual(
      [first.material.color.getHex(), first.material.emissive.getHex()],
      original[0],
    );
    hit = null;
    move({ offsetX: 70, offsetY: 80 } as unknown as Event);
    assert.deepEqual(
      [second.material.color.getHex(), second.material.emissive.getHex()],
      original[1],
    );

    hit = { object: first } as NonNullable<typeof hit>;
    move({ offsetX: 23, offsetY: 41 } as unknown as Event);
    leave(new Event('pointerleave'));
    assert.deepEqual(
      [first.material.color.getHex(), first.material.emissive.getHex()],
      original[0],
    );
    hit = { object: second } as NonNullable<typeof hit>;
    move({ offsetX: 40, offsetY: 52 } as unknown as Event);
    values.highlightEnabled = false;
    change(values, 'highlightEnabled');
    assert.deepEqual(
      [second.material.color.getHex(), second.material.emissive.getHex()],
      original[1],
    );
    assert.ok(invalidations >= 6);

    assert.ok(pagehide);
    if (typeof pagehide === 'function') pagehide(new Event('pagehide'));
    else pagehide.handleEvent(new Event('pagehide'));
    assert.equal(disposed, 1);
  } finally {
    globalThis.addEventListener = previous;
  }
});
