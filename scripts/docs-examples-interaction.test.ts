import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import { pointerOnPlane } from '../site/examples/kit/pointer.ts';

type Event = {
  button?: number;
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
};

test('drag-a-crate moves on the floor and restores the orbit state on every release', async () => {
  const html = await readFile(
    new URL('../site/examples/drag-a-crate.html', import.meta.url),
    'utf8',
  );
  const listeners = new Map<string, (event: Event) => void>(),
    captured = new Set<number>();
  const node = () => ({
    position: {
      x: 0,
      y: 0,
      z: 0,
      set(x: number, y: number, z: number) {
        Object.assign(this, { x, y, z });
      },
    },
  });
  const floor = node(),
    crate = node(),
    orbit = { enabled: true, target: { set() {} } };
  let made = 0,
    ui = { snap: false, home: () => {} },
    invalidations = 0;
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    addEventListener: (name: string, listener: (event: Event) => void) =>
      listeners.set(name, listener),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  };
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({
        scene: { background: null, add() {} },
        canvas,
        controls: orbit,
        camera: {
          position: { set() {} },
          lookAt() {},
          rayThrough: (x: number, y: number) => ({
            origin: { x: 0, y: 10, z: 0 },
            direction: { x, y: -10, z: -y },
          }),
        },
        invalidate: () => invalidations++,
        raycast: (at: { x: number; y: number }, options: { objects: object[] }) => {
          if (options.objects[0] === crate)
            return at.x === 99 ? null : { point: { x: 0, y: 1.4, z: 0 } };
          throw new Error('pointer moves use pointerOnPlane');
        },
      }),
      geometry: { box: () => ({}) },
      material: { meshStandard: () => ({}) },
      object: { mesh: () => (++made === 1 ? floor : crate) },
      light: { directional: () => ({}), hemisphere: () => ({}) },
      math: { color: (v: string) => v },
    },
    kit: { controls: (specs: typeof ui) => (ui = specs), pointerOnPlane },
  });
  const fire = (name: string, event: Event) => listeners.get(name)!(event);

  const event = (x: number, y: number, pointerId: number, button?: number) => ({
    button,
    clientX: x,
    clientY: y,
    offsetX: x,
    offsetY: y,
    pointerId,
  });
  fire('pointerdown', event(99, 0, 1, 0));
  assert.equal(captured.size, 0, 'empty floor starts no drag');
  fire('pointerdown', event(50, 50, 2, 0));
  assert.equal(orbit.enabled, false);
  fire('pointermove', event(70, 60, 2));
  assert.ok(Math.abs(crate.position.x - 0.344) < 1e-12);
  assert.ok(Math.abs(crate.position.z - 0.172) < 1e-12);
  assert.equal(crate.position.y, 0.7);
  fire('pointerup', event(70, 60, 2));
  assert.equal(orbit.enabled, true);

  ui.snap = true;
  fire('pointerdown', event(50, 50, 3, 0));
  fire('pointermove', event(100, 100, 3));
  assert.deepEqual([crate.position.x, crate.position.y, crate.position.z], [1, 0.7, 1]);
  fire('pointermove', event(1000, -1000, 3));
  assert.deepEqual([crate.position.x, crate.position.y, crate.position.z], [5.3, 0.7, -3.8]);
  fire('pointercancel', event(100, 100, 3));
  assert.equal(orbit.enabled, true, 'cancel restores orbit');
  orbit.enabled = false;
  fire('pointerdown', event(50, 50, 4, 0));
  captured.delete(4);
  fire('lostpointercapture', event(50, 50, 4));
  assert.equal(orbit.enabled, false, 'lost capture restores the prior orbit state');
  fire('pointermove', event(0, 0, 4));
  assert.deepEqual([crate.position.x, crate.position.z], [5.3, -3.8], 'lost capture ends the drag');
  ui.home();
  assert.deepEqual([crate.position.x, crate.position.y, crate.position.z], [0, 0.7, 0]);
  assert.equal(invalidations, 4, 'three moves and Home redraw');
});
