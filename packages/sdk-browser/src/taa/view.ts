import { invertMatrix4, matrixAtRenderOrigin } from '../../../sdk-core/src/index.ts';
import { TAA_SAMPLES } from './jitter.ts';
import { taaWeightTable } from './weights.ts';
import { TAA_VIEW_BYTES } from './shaderWgsl.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { TaaFrameState } from './frame.ts';

const anchored = new Float64Array(16),
  packed = new Float32Array(TAA_VIEW_BYTES / 4),
  /** Filter weights for each of the eight native jitter ranks: they depend only on it. */
  weights = taaWeightTable();

/** Writes `(width, height, 1/width, 1/height)` at `at`. */
function writeGrid(at: number, [width, height]: readonly number[]) {
  packed[at] = width;
  packed[at + 1] = height;
  packed[at + 2] = 1 / width;
  packed[at + 3] = 1 / height;
}

/**
 * The pass's uniform for this frame (`TaaView`, `shaderWgsl.ts`): both matrices at the eye, the
 * display grid the history has, the current share and history flags, the native filter weights
 * of this jitter rank, the `render` grid the frame was drawn in and its jitter.
 */
export function writeTaaView(
  device: GPUDevice,
  uniform: GPUBuffer,
  state: TaaFrameState,
  cam: EngineCamera,
  render: readonly number[],
  display: readonly number[],
  moved: boolean,
) {
  matrixAtRenderOrigin(packed, state.previousViewProjection, cam.eye, 0);
  // Inverse of the view-projection WITHOUT jitter: the reprojected pixel is its unshifted centre,
  // with the depth read at the shifted sample. At a fixed camera, history is thus re-read exactly
  // on its texel — re-read to the jitter, it would be resampled bilinearly every image and would
  // soften without end.
  matrixAtRenderOrigin(anchored, cam.viewProjection, cam.eye);
  packed.set(invertMatrix4(anchored, anchored), 16);
  writeGrid(32, display);
  // Share of the current image: 1/k at the k-th quiet image, one eighth in motion.
  packed[36] = state.stillFrames > 0 ? 1 / state.stillFrames : 1 / TAA_SAMPLES;
  packed[37] = state.hasHistory ? 1 : 0;
  packed[38] = moved ? 1 : 0;
  packed[39] = 0;
  packed.set(weights[state.sample % TAA_SAMPLES], 40);
  writeGrid(52, render);
  packed[56] = state.jitter[0];
  packed[57] = state.jitter[1];
  device.queue.writeBuffer(uniform, 0, packed);
}
