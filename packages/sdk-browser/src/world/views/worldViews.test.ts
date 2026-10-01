import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { createWorldViews } from './worldViews.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { PresentRect } from '../../gpu/core/presentAt.ts';

function session() {
  const rows: { camera: HostCamera; rect: PresentRect; released: boolean }[] = [];
  let main: PresentRect | null = null;
  const explorer = {
    camera: hostFramingCamera(60, 1, 0.1, 100),
    views: {
      setMask() {},
      setRect(rect: PresentRect | null) {
        main = rect;
      },
      async add(camera: HostCamera, rect: PresentRect) {
        const row = { camera, rect, released: false };
        rows.push(row);
        return {
          resize(rect: PresentRect) {
            row.rect = rect;
          },
          display() {},
          dispose() {
            row.released = true;
          },
        };
      },
    },
  } as unknown as MeasuredWorld;
  return { explorer, rows, main: () => main };
}

test('a world view keeps identity while camera and CSS rectangle change, then reconnects after reopening', async () => {
  const surface = fixtureSurface(),
    canvas = surface.element as HTMLCanvasElement;
  canvas.width = canvas.height = 800;
  const camera = new Camera('perspective');
  const manager = createWorldViews(
    canvas,
    () => camera,
    () => {},
    (_nodes, draw) => draw(),
  );
  const other = new Camera('perspective');
  other.position.x = 7;
  const view = manager.addView({ camera: other, rect: { x: 200, y: 0, width: 200, height: 400 } });
  const first = session();
  await manager.opened(first.explorer);
  await view.ready;
  manager.rect = { x: 0, y: 0, width: 200, height: 400 };
  manager.beforeFrame();
  assert.equal(first.rows.length, 1, 'main camera is reused, not added as a hidden extra view');
  assert.deepEqual(first.rows[0].rect, { x: 400, y: 0, width: 400, height: 800 });
  assert.equal(first.rows[0].camera.position.x, 7);
  assert.equal(first.explorer.camera.aspect, 0.5);
  assert.deepEqual(first.main(), { x: 0, y: 0, width: 400, height: 800 });
  other.position.x = 11;
  view.rect = { x: 100, y: 20, width: 100, height: 50 };
  manager.beforeFrame();
  assert.equal(first.rows.length, 1, 'resize does not allocate another backend view');
  assert.equal(first.rows[0].camera.position.x, 11);
  assert.equal(first.rows[0].camera.aspect, 2);
  manager.closed();
  manager.beforeFrame();
  const second = session();
  await manager.opened(second.explorer);
  assert.equal(second.rows.length, 1);
  manager.beforeFrame();
  assert.equal(second.rows[0].camera.position.x, 11);
  view.dispose();
  manager.dispose();
  assert.equal(second.rows[0].released, true);
  assert.equal(surface.listeners(), 0);
});

test('a view removed during admission releases the late grant and never reappears', async () => {
  const surface = fixtureSurface(),
    camera = new Camera('perspective');
  const manager = createWorldViews(
    surface.element as HTMLCanvasElement,
    () => camera,
    () => {},
    (_nodes, draw) => draw(),
  );
  const view = manager.addView({ camera, rect: { x: 0, y: 0, width: 100, height: 100 } });
  const late = session();
  let grant!: () => void,
    released = 0;
  late.explorer.views.add = () =>
    new Promise((resolve) => {
      grant = () =>
        resolve({
          resize() {},
          display() {},
          async dispose() {
            released++;
          },
        });
    });
  const opening = manager.opened(late.explorer);
  view.dispose();
  await assert.rejects(view.ready, /VIEW_RELEASED/);
  grant();
  await opening;
  assert.equal(released, 1);
  manager.dispose();
  assert.equal(surface.listeners(), 0);
});
