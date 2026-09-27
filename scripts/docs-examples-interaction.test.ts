import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';

type Event = { button?: number; offsetX: number; offsetY: number; pointerId: number };

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
        camera: { position: { set() {} }, lookAt() {} },
        invalidate: () => invalidations++,
        raycast: (at: { x: number; y: number }, options: { objects: object[] }) => {
          if (options.objects[0] === crate)
            return at.x === 99 ? null : { point: { x: 0.2, z: -0.3 } };
          return { point: { x: at.x / 10, z: at.y / 10 } };
        },
      }),
      geometry: { box: () => ({}) },
      material: { meshStandard: () => ({}) },
      object: { mesh: () => (++made === 1 ? floor : crate) },
      light: { directional: () => ({}), hemisphere: () => ({}) },
      math: { color: (v: string) => v },
    },
    kit: { controls: (specs: typeof ui) => (ui = specs) },
  });
  const fire = (name: string, event: Event) => listeners.get(name)!(event);

  fire('pointerdown', { button: 0, offsetX: 99, offsetY: 0, pointerId: 1 });
  assert.equal(captured.size, 0, 'empty floor starts no drag');
  fire('pointerdown', { button: 0, offsetX: 10, offsetY: 10, pointerId: 2 });
  assert.equal(orbit.enabled, false);
  fire('pointermove', { offsetX: 24, offsetY: 17, pointerId: 2 });
  assert.ok(Math.abs(crate.position.x - 2.2) < 1e-12);
  assert.deepEqual([crate.position.y, crate.position.z], [0.7, 2]);
  fire('pointerup', { offsetX: 24, offsetY: 17, pointerId: 2 });
  assert.equal(orbit.enabled, true);

  ui.snap = true;
  fire('pointerdown', { button: 0, offsetX: 10, offsetY: 10, pointerId: 3 });
  fire('pointermove', { offsetX: 27, offsetY: 14, pointerId: 3 });
  assert.deepEqual([crate.position.x, crate.position.y, crate.position.z], [4.5, 0.7, 3.5]);
  fire('pointercancel', { offsetX: 27, offsetY: 14, pointerId: 3 });
  orbit.enabled = false;
  fire('pointerdown', { button: 0, offsetX: 10, offsetY: 10, pointerId: 4 });
  captured.delete(4);
  fire('lostpointercapture', { offsetX: 10, offsetY: 10, pointerId: 4 });
  assert.equal(orbit.enabled, false, 'lost capture restores the prior orbit state');
  ui.home();
  assert.deepEqual([crate.position.x, crate.position.y, crate.position.z], [0, 0.7, 0]);
  assert.equal(invalidations, 3, 'two moves and Home redraw');
});
