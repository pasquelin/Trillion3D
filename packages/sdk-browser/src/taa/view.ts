import { invertMatrix4, matrixAtRenderOrigin } from '../../../sdk-core/src/index.ts';
import { TAA_SAMPLES } from './jitter.ts';
import { taaWeightTable } from './weights.ts';
import { TAA_VIEW_BYTES } from './bindingsWgsl.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { TaaFrameState } from './frameState.ts';

const anchored = new Float64Array(16),
  packed = new Float32Array(TAA_VIEW_BYTES / 4),
  /** Filter weights for each of the eight native jitter ranks: they depend only on it. */
  weights = taaWeightTable();

/** Writes `(width, height, 1/width, 1/height)` at `at`. */
function writeGrid(into: Float32Array, at: number, [width, height]: readonly number[]) {
  into[at] = width;
  into[at + 1] = height;
  into[at + 2] = 1 / width;
  into[at + 3] = 1 / height;
}

/**
 * The header `taaReprojectWgsl` reads (`prevViewProj`, `invViewProj`, `viewport`), floats 0 to 35
 * of `into`: `previous` and the inverse of `current`, both anchored at `eye`, then `grid`. The
 * temporal pass's uniform and the reflections' (`historyRuntime.ts`, `source.ts`) start with it.
 */
export function writeReprojection(
  into: Float32Array,
  previous: ArrayLike<number>,
  current: ArrayLike<number>,
  eye: ArrayLike<number>,
  grid: readonly number[],
) {
  matrixAtRenderOrigin(into, previous, eye, 0);
  matrixAtRenderOrigin(anchored, current, eye);
  into.set(invertMatrix4(anchored, anchored), 16);
  writeGrid(into, 32, grid);
}

/**
 * The pass's uniform for this frame (`TaaView`, `shaderWgsl.ts`): both matrices at the eye, the
 * display grid the history has, the current share and history flags, the native filter weights
 * of this jitter rank, the `render` grid the frame was drawn in, its jitter and whether it moves
 * (`historyWgsl.ts`), the eye; `layers`, the display layers' history holds the last image's;
 * `deformed`, a GPU deformation moved (#357).
 */
export function writeTaaView(
  device: GPUDevice,
  uniform: GPUBuffer,
  state: TaaFrameState,
  cam: EngineCamera,
  render: readonly number[],
  display: readonly number[],
  moved: boolean,
  layers = false,
  deformed = false,
) {
  // Inverse of the view-projection WITHOUT jitter: the reprojected pixel is its unshifted centre,
  // with the depth read at the shifted sample. At a fixed camera, history is thus re-read exactly
  // on its texel — re-read to the jitter, it would be resampled bilinearly every image and would
  // soften without end.
  writeReprojection(packed, state.previousViewProjection, cam.viewProjection, cam.eye, display);
  // Share of the current image: 1/k at the k-th quiet image, one eighth in motion.
  packed[36] = state.stillFrames > 0 ? 1 / state.stillFrames : 1 / TAA_SAMPLES;
  packed[37] = state.hasHistory ? 1 : 0;
  packed[38] = moved ? 1 : 0;
  packed[39] = layers ? 1 : 0;
  packed.set(weights[state.sample % TAA_SAMPLES], 40);
  writeGrid(packed, 52, render);
  packed[56] = state.jitter[0];
  packed[57] = state.jitter[1];
  packed[58] = state.stillFrames > 0 ? 0 : 1;
  packed.set(cam.eye, 60);
  packed[63] = deformed ? 1 : 0;
  device.queue.writeBuffer(uniform, 0, packed);
}
