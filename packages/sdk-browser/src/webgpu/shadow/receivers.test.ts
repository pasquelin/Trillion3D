// The receivers a frame hands its early shadow demand (#1209): the world box of every cluster it
// draws inside the camera's frustum, and a pixel's footprint at the drawn target's size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { demandMarginTexels } from '../../../../sdk-core/src/scene/light-shadow/demand.ts';
import { createReceiverCells } from '../../../../sdk-core/src/scene/light-shadow/receiverCells.ts';
import { VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import type { EngineCamera } from '../../camera/engineCamera.ts';
import { PCF_REACH } from '../../lighting/direct/shadowWgsl.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { viewPlanes } from './demand.fixture.ts';
import { shadowReceivers } from './receivers.ts';

test("the demand's margin covers the normal offset, the taps and the neighbour page", () => {
  assert.ok(demandMarginTexels() >= LIGHT_SETTINGS.shadowNormalOffsetTexels + PCF_REACH + 1.5);
});

test('the receivers are the drawn clusters in world space, the frustum keeping what it lights', () => {
  const at = (x: number, y: number, z: number) =>
    ({
      min: [-1, -1, -1],
      max: [1, 1, 1],
      matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] },
    }) as unknown as PageRec;
  const projection = new Float64Array(16);
  projection[5] = 1 / Math.tan(VIEW.halfFovY);
  const cam = {
    planes: viewPlanes(VIEW),
    projection,
    near: VIEW.near,
    perspective: 1,
  } as unknown as EngineCamera;
  // Ahead of the eye, behind it, then ahead again.
  const drawn = [at(0, 5, -10), at(0, 5, 10), at(2, 3, -20)];
  const receivers = shadowReceivers(drawn, cam, 360, 720);
  assert.equal(receivers.count, 3);
  assert.deepEqual(
    [...receivers.boxes.subarray(0, 18)],
    [-1, 4, -11, 1, 6, -9, -1, 4, 9, 1, 6, 11, 1, 2, -21, 3, 4, -19],
  );
  // The demand keeps what the frustum keeps: the box behind the eye joins no cell.
  assert.equal(createReceiverCells().gather(receivers, VIEW).count, 2);
  assert.ok(
    Math.abs(receivers.pixelNear - (2 * VIEW.near * Math.tan(VIEW.halfFovY)) / 720) < 1e-12,
  );
  assert.ok(
    Math.abs(receivers.pixelNearMost - (2 * VIEW.near * Math.tan(VIEW.halfFovY)) / 360) < 1e-12,
  );
  assert.equal(receivers.orthographic, false);
  assert.equal(receivers.planes, cam.planes);
});
