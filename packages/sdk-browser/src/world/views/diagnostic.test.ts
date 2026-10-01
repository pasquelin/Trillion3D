import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldViews } from './worldViews.ts';
import { fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { families } from '../../host/families.ts';

test('a diagnostic waits for its code, and disposal or a newer request cancels its late publication', async (t) => {
  let resolve!: () => void;
  const loading = new Promise<void>((done) => {
    resolve = done;
  });
  t.mock.method(families.diagnostics, 'load', () => loading);
  const applied: string[] = [],
    errors: unknown[] = [];
  const canvas = fixtureSurface(),
    camera = new Camera('perspective');
  const manager = createWorldViews(
    canvas.element as HTMLCanvasElement,
    () => camera,
    () => {},
    (_nodes, draw) => draw(),
    (error) => errors.push(error),
  );
  const explorer = {
    camera: hostFramingCamera(60, 1, 0.1, 100),
    views: {
      setMask() {},
      setRect() {},
      async add() {
        return {
          resize() {},
          dispose() {},
          display(mode: string) {
            applied.push(mode);
          },
        };
      },
    },
  } as unknown as MeasuredWorld;
  const view = manager.addView({ camera, rect: { x: 0, y: 0, width: 100, height: 100 } });
  await manager.opened(explorer);
  view.diagnostic.mode = 'triangles';
  assert.deepEqual(applied, [], 'no frame can request an unavailable diagnostic shader');
  view.diagnostic.mode = 'beauty';
  assert.deepEqual(applied, ['beauty']);
  resolve();
  await loading;
  await Promise.resolve();
  assert.deepEqual(applied, ['beauty'], 'late triangles do not override the newer beauty request');
  view.diagnostic.mode = 'triangles';
  view.dispose();
  await Promise.resolve();
  assert.deepEqual(applied, ['beauty'], 'a released view cannot publish a late import result');
  assert.deepEqual(errors, []);
  manager.dispose();
});

test('changing a diagnostic during reopen never addresses the old renderer', async () => {
  const canvas = fixtureSurface(),
    camera = new Camera('perspective');
  const manager = createWorldViews(
    canvas.element as HTMLCanvasElement,
    () => camera,
    () => {},
    (_nodes, draw) => draw(),
  );
  let writes = 0;
  const explorer = {
    camera: hostFramingCamera(60, 1, 0.1, 100),
    views: {
      setMask() {},
      setRect() {},
      async add() {
        return {
          resize() {},
          dispose() {},
          display() {
            writes++;
          },
        };
      },
    },
  } as unknown as MeasuredWorld;
  const view = manager.addView({ camera, rect: { x: 0, y: 0, width: 100, height: 100 } });
  await manager.opened(explorer);
  manager.closed();
  view.diagnostic.mode = 'beauty';
  manager.beforeFrame();
  assert.equal(writes, 0);
  await manager.opened(explorer);
  manager.beforeFrame();
  assert.equal(writes, 1, 'the desired setting is applied to the new attachment');
  manager.dispose();
});
