import { copyMatrix4, multiplyMatrix4 } from '../../../../../sdk-core/src/index.ts';
import { screenErrorBound } from '../../../../../sdk-core/src/lod/screenErrorBound.ts';
import { viewDepthOf, viewLateralOf } from '../../../page/selection/projection.ts';
import { OPEN_PLANES, openMark } from '../../../page/cut/openRoot.ts';
import type { DagViewUniforms, PackedDag } from '../types.ts';

/**
 * The CPU mirror of the kernel's planes taken into a placement's local space (`m`, 4x4
 * column-major): each plane `p` becomes `p · m`, so a local point `q` yields `p · (m q)` and a local
 * box is tested untransformed.
 */
export function frustumPlanesToLocal(
  out: Float64Array,
  planes: ArrayLike<number>,
  m: ArrayLike<number>,
) {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4],
      b = planes[i * 4 + 1],
      c = planes[i * 4 + 2],
      d = planes[i * 4 + 3];
    out[i * 4] = m[0] * a + m[1] * b + m[2] * c + m[3] * d;
    out[i * 4 + 1] = m[4] * a + m[5] * b + m[6] * c + m[7] * d;
    out[i * 4 + 2] = m[8] * a + m[9] * b + m[10] * c + m[11] * d;
    out[i * 4 + 3] = m[12] * a + m[13] * b + m[14] * c + m[15] * d;
  }
}

/** Column-major 4×4 buffers rewritten per world, never reallocated. */
export const dagScratch = {
  view: new Float64Array(16),
  world: new Float64Array(16),
  viewMatrix: new Float64Array(16),
  cone: { axis: [0, 0, 1] as [number, number, number], angle: Math.PI },
  min: [0, 0, 0] as number[],
  max: [0, 0, 0] as number[],
};

/**
 * CPU mirror of `projected` in the `../shader/shader.ts` shader: same guards, same operands,
 * same order. The shader does not throw, so the oracle does not either — a negative or
 * NaN error returns infinity there, where sdk-core's `clusterErrorAtDepth` refuses its
 * parameters. Those are two different contracts of the same `screenErrorBound` bound:
 * the validating function cannot replace this one.
 */
export function projectedError(
  error: number,
  sx: number,
  sy: number,
  sz: number,
  radius: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  perspective = 1,
) {
  if (error === 0) return 0;
  if (!(error > 0)) return Infinity;
  const lateral = viewLateralOf(sx, sy, sz, e),
    depth = viewDepthOf(sx, sy, sz, e);
  return screenErrorBound(error, stretch, lateral, depth, radius, focal, near, perspective);
}

/**
 * What a frame sets per primitive before any descent: trunk planes brought into the
 * primitive's space, the view·world matrix, and object-view stretch. Two CPU descents
 * asked for it word for word — the oracle (`oracle.fixture.ts`) and frontier counting
 * (`../cutFrontier.fixture.ts`) — ; it is written only here, so neither can drift
 * from the kernel without the other doing so too.
 */
export type DagViewFrames = {
  planes: Float64Array[];
  views: number[][];
  stretches: number[];
  focal: number;
  near: number;
  /** The projection's clip-w weight, and the camera as a homogeneous point of the render frame:
   *  the origin under a perspective projection, the way back under an orthographic one. */
  perspective: number;
  viewPoint: Float64Array;
  pixelError: number;
};
export function dagViewFrames(
  packed: Pick<PackedDag, 'worlds' | 'worldStretch' | 'worldCount'> & Partial<PackedDag>,
  uniforms: DagViewUniforms,
): DagViewFrames {
  const cameraStretch = uniforms.cameraStretch ?? 1,
    perspective = uniforms.perspective ?? 1;
  const planes: Float64Array[] = [],
    views: number[][] = [],
    stretches: number[] = [];
  const { view, world, viewMatrix } = dagScratch;
  copyMatrix4(view, uniforms.view);
  for (let w = 0; w < packed.worldCount; w++) {
    copyMatrix4(world, packed.worlds, 0, w * 16);
    const object = new Float64Array(24);
    frustumPlanesToLocal(object, uniforms.planes, world);
    if (openMark(packed.mark?.[w])) object.set(OPEN_PLANES);
    planes.push(object);
    multiplyMatrix4(viewMatrix, view, world);
    views.push(Array.from(viewMatrix));
    stretches.push(packed.worldStretch[w] * cameraStretch);
  }
  return {
    planes,
    views,
    stretches,
    focal: Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]),
    near: uniforms.near,
    perspective,
    viewPoint: Float64Array.of(
      view[2] * (1 - perspective),
      view[6] * (1 - perspective),
      view[10] * (1 - perspective),
      perspective,
    ),
    pixelError: uniforms.pixelError,
  };
}
