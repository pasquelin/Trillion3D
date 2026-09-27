/**
 * A capture the host composes draws the session's camera at the capture's shape: an orthographic
 * camera keeps its box's matrix through the draw and after it, whatever aspect the capture writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { HostCamera } from '../../camera/world.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import { followPageCamera } from '../core/worldCamera.ts';
import { createExplorerCaptureView } from './view.ts';

test('an orthographic capture draws and gives back the box matrix, not a perspective one', async () => {
  const session = hostFramingCamera(50, 1, 0.1, 100);
  const page = new Camera('orthographic', { left: -4, right: 4, top: 2, bottom: -2, far: 50 });
  followPageCamera(() => page, { width: 800, height: 400 } as HTMLCanvasElement)(session);
  const box = Array.from(session.projectionMatrix.elements);
  const drawn: number[][] = [];
  const capture = createExplorerCaptureView({
    camera: session,
    context: createTestContext().gl,
    active: () =>
      ({
        render: (camera: HostCamera) => drawn.push(Array.from(camera.projectionMatrix.elements)),
      }) as unknown as RenderBackend,
    check: () => {},
    compose: (() => {}) as never,
  });
  await capture(64, 16);
  assert.deepEqual(drawn, [box], 'the capture draws the box');
  assert.deepEqual(Array.from(session.projectionMatrix.elements), box, 'and gives it back');
});
