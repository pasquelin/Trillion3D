import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { createViewInput } from './input.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { createPanZoomCameraControls } from '../../camera/controls/panZoomControls.ts';

test('panZoom gestures affect only their rectangle and a drag stays owned outside it', () => {
  const canvas = fixtureSurface(),
    router = createViewInput(canvas.element as HTMLCanvasElement);
  const left = router.region(() => ({ x: 0, y: 0, width: 200, height: 400 }));
  const right = router.region(() => ({ x: 200, y: 0, width: 200, height: 400 }));
  const a = new Camera('orthographic'),
    b = new Camera('orthographic');
  a.position.z = b.position.z = 10;
  const controls = [
    createPanZoomCameraControls(a, left.surface),
    createPanZoomCameraControls(b, right.surface),
  ];
  canvas.fire('wheel', { clientX: 250, clientY: 100, deltaY: 100, deltaMode: 0 });
  assert.equal(a.zoom, 1);
  assert.notEqual(b.zoom, 1);
  const original = a.position.x;
  canvas.fire('pointerdown', { pointerId: 3, button: 0, clientX: 50, clientY: 100 });
  canvas.fire('pointermove', { pointerId: 3, clientX: 350, clientY: 100 });
  assert.notEqual(a.position.x, original, 'the left camera follows its drag beyond its rectangle');
  assert.equal(b.position.x, 0, 'crossing the right rectangle does not steer it');
  for (const control of controls) control.dispose();
  left.dispose();
  right.dispose();
  router.dispose();
  assert.equal(canvas.listeners(), 0);
  assert.equal(canvas.touchAction(), 'pan-y');
});

test('listener identity includes event type and every pointerup handler receives the same release', async () => {
  const canvas = fixtureSurface(),
    router = createViewInput(canvas.element as HTMLCanvasElement);
  const region = router.region(() => ({ x: 0, y: 0, width: 400, height: 400 }));
  const heard: string[] = [],
    shared = (event: Event) => heard.push(event.type);
  region.surface.addEventListener('pointerdown', shared);
  region.surface.addEventListener('pointerup', shared);
  region.surface.addEventListener('pointerup', () => heard.push('second release'));
  canvas.fire('pointerdown', { type: 'pointerdown', pointerId: 1, clientX: 10, clientY: 10 });
  canvas.fire('pointerup', { type: 'pointerup', pointerId: 1, clientX: 900, clientY: 10 });
  assert.deepEqual(heard, ['pointerdown', 'pointerup', 'second release']);
  await Promise.resolve();
  region.surface.removeEventListener('pointerdown', shared);
  canvas.fire('pointerdown', { type: 'pointerdown', pointerId: 2, clientX: 10, clientY: 10 });
  assert.equal(heard.length, 3);
  region.dispose();
  router.dispose();
  assert.equal(
    canvas.listeners(),
    0,
    'dispose removes even listeners whose owner did not explicitly remove them',
  );
});
