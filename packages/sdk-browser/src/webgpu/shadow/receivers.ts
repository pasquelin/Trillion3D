import { boxTransform } from '../../../../sdk-core/src/index.ts';
import {
  RECEIVER_FLOATS,
  type ShadowReceivers,
} from '../../../../sdk-core/src/scene/light-shadow/receiverCells.ts';
import type { EngineCamera } from '../../camera/engineCamera.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { pixelNearOf } from '../../streaming/priority.ts';

/** The frame's receivers, rewritten in place: their boxes grow with the largest cut, never shrink. */
const receivers: ShadowReceivers & { boxes: Float64Array } = {
  boxes: new Float64Array(0),
  count: 0,
  planes: new Float64Array(24),
  pixelNear: 0,
  pixelNearMost: 0,
  orthographic: false,
};
const local = new Float64Array(RECEIVER_FLOATS);

/**
 * THE SURFACES THE FRAME'S SHADING LIGHTS, before its shadow raster: the world box of every
 * cluster the frame draws — the CPU cut's, or the GPU cut's as its latest readback adopted it
 * (`run.drawn`) —, the camera's frustum, which keeps what it lights, and a pixel's footprint at
 * the near plane for the passes that read shadows: the deferred one at the drawn target's height,
 * the blend at the display's. What the scheduler reads its early demand from (`demand.ts`): every
 * page these receivers read is drawn before the frame samples it. The GPU cut's clusters trail
 * its draw by a readback: what it draws before they land, the shading's report names a frame late.
 */
export function shadowReceivers(
  drawn: readonly PageRec[],
  cam: EngineCamera,
  targetHeight: number,
  displayHeight: number,
) {
  if (receivers.boxes.length < drawn.length * RECEIVER_FLOATS)
    receivers.boxes = new Float64Array(drawn.length * RECEIVER_FLOATS * 2);
  const b = receivers.boxes;
  let count = 0;
  for (const rec of drawn) {
    for (let k = 0; k < 3; k++) {
      local[k] = rec.min[k];
      local[k + 3] = rec.max[k];
    }
    boxTransform(b, count++ * RECEIVER_FLOATS, local, 0, rec.matrix.elements);
  }
  receivers.count = count;
  receivers.planes = cam.planes;
  receivers.pixelNear = pixelNearOf(
    cam.projection,
    Math.max(targetHeight, displayHeight),
    cam.near,
  );
  receivers.pixelNearMost = pixelNearOf(
    cam.projection,
    Math.min(targetHeight, displayHeight),
    cam.near,
  );
  receivers.orthographic = cam.perspective === 0;
  return receivers;
}
