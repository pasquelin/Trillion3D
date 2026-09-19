import * as THREE from 'three';
import { frustumExcludesBox, frustumPlanesToLocal, screenErrorBound } from '../sdk-core/index.ts';
import { errorFloorAt, viewDepthOf, viewLateralOf } from './pageSelectionProjection.ts';
import { DAG_NODE_FLOATS } from './gpuDagTypes.ts';
import {
  NODE_CEIL,
  NODE_CHILD_COUNT,
  NODE_FLAGS,
  NODE_FLOOR,
  NODE_FLOOR_SPHERE,
  NODE_HAS_ROOT,
  NODE_MAX,
  NODE_MIN,
  NODE_SPHERE,
  NODE_WORLD,
} from './gpuDagPackNodes.ts';
import type { SelectionUniforms } from './gpuSelection.ts';

export const dagScratch = {
  view: new THREE.Matrix4(),
  world: new THREE.Matrix4(),
  viewMatrix: new THREE.Matrix4(),
  cone: { axis: [0, 0, 1] as [number, number, number], angle: Math.PI },
  min: [0, 0, 0] as number[],
  max: [0, 0, 0] as number[],
};

/**
 * CPU mirror of `projected` in the `gpuDagShader.ts` shader: same guards, same operands,
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
) {
  if (error === 0) return 0;
  if (!(error > 0)) return Infinity;
  const lateral = viewLateralOf(sx, sy, sz, e);
  return screenErrorBound(error, stretch, lateral, viewDepthOf(sx, sy, sz, e), radius, focal, near);
}

/**
 * What a frame sets per primitive before any descent: trunk planes brought into the
 * primitive's space, the view·world matrix, and object-view stretch. Two CPU descents
 * asked for it word for word — the oracle (`gpuDagOracle.ts`) and frontier counting
 * (`gpuDagCutFrontierFixture.ts`) — ; it is written only here, so neither can drift
 * from the kernel without the other doing so too.
 */
export type DagViewFrames = {
  planes: Float64Array[];
  views: number[][];
  stretches: number[];
  focal: number;
  near: number;
  pixelError: number;
};
export function dagViewFrames(
  packed: { worlds: Float32Array; worldStretch: Float32Array; worldCount: number },
  uniforms: SelectionUniforms,
): DagViewFrames {
  const cameraStretch = uniforms.cameraStretch ?? 1;
  const planes: Float64Array[] = [],
    views: number[][] = [],
    stretches: number[] = [];
  const { view, world, viewMatrix } = dagScratch;
  view.fromArray(uniforms.view);
  for (let w = 0; w < packed.worldCount; w++) {
    world.fromArray(packed.worlds.subarray(w * 16, w * 16 + 16));
    const object = new Float64Array(24);
    frustumPlanesToLocal(object, uniforms.planes, world.elements);
    planes.push(object);
    viewMatrix.multiplyMatrices(view, world);
    views.push([...viewMatrix.elements]);
    stretches.push(packed.worldStretch[w] * cameraStretch);
  }
  return {
    planes,
    views,
    stretches,
    focal: Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]),
    near: uniforms.near,
    pixelError: uniforms.pixelError,
  };
}

/** Kernel verdict on a cut node (`gpuDagLevelWgsl.ts`, `levelStep`): `-1` rejected —
 *  outside the trunk, or whose subtree replacement is not yet too coarse —, otherwise
 *  the number of children it opens, `0` meaning a kept leaf. */
export function dagNodeVerdict(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
) {
  const base = n * DAG_NODE_FLOATS,
    w = ints[base + NODE_WORLD];
  if (
    frustumExcludesBox(
      f.planes[w],
      nodes[base + NODE_MIN],
      nodes[base + NODE_MIN + 1],
      nodes[base + NODE_MIN + 2],
      nodes[base + NODE_MAX],
      nodes[base + NODE_MAX + 1],
      nodes[base + NODE_MAX + 2],
    )
  )
    return -1;
  const ceil = nodes[base + NODE_CEIL];
  if (
    ceil >= 0 &&
    projectedError(
      ceil,
      nodes[base + NODE_SPHERE],
      nodes[base + NODE_SPHERE + 1],
      nodes[base + NODE_SPHERE + 2],
      nodes[base + NODE_SPHERE + 3],
      f.views[w],
      f.stretches[w],
      f.focal,
      f.near,
    ) <= f.pixelError
  )
    return -1;
  return ints[base + NODE_CHILD_COUNT];
}

/**
 * The subtree error FLOOR, projected as the kernel projects it (`gpuDagLevelWgsl.ts`,
 * `errorFloor`): above the threshold none of its clusters is fine enough and the cut
 * takes none. A subtree that carries a cluster nothing replaces is exempt — the pinned
 * fallback draws it without consulting a threshold — and returns zero, so never prunes.
 */
export function dagNodeFloor(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
) {
  const base = n * DAG_NODE_FLOATS,
    w = ints[base + NODE_WORLD];
  if (ints[base + NODE_FLAGS] & NODE_HAS_ROOT) return 0;
  return errorFloorAt(
    nodes[base + NODE_FLOOR],
    viewDepthOf(
      nodes[base + NODE_FLOOR_SPHERE],
      nodes[base + NODE_FLOOR_SPHERE + 1],
      nodes[base + NODE_FLOOR_SPHERE + 2],
      f.views[w],
    ),
    nodes[base + NODE_FLOOR_SPHERE + 3],
    f.stretches[w],
    f.focal,
  );
}
