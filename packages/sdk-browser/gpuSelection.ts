/**
 * The contract every GPU selection kernel honours, and the camera state it reads.
 *
 * The runtime has one kernel, `gpuDagSelection`: a cluster DAG where each cluster carries its own
 * screen-error band. This module holds what is common to a kernel and its callers — the uniform
 * block, the readback shape and the page-cone convention — so neither side owns the other.
 */
import { FRUSTUM_PLANE_VALUES, maxStretch } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { OPEN_CONE, type NormalCone } from './pageCone.ts';
import { sameElements } from './matrixElements.ts';
import { pixelScaleOf } from './streamingPriority.ts';
import type { EngineCamera } from './cameraWorld.ts';

const NONE = 0xffffffff,
  UNIFORM_BYTES = 256,
  WORKGROUP = 64;
/** Words per cluster of the shared cold record — cone, box, owning node, triangles.
 *  Public mirror of `COLD_WORDS` (`gpuDagLayout.ts`), which is its only source. */
export const PAGE_CONE_FLOATS = 13,
  SELECTION_NONE = NONE,
  SELECTION_UNIFORM_BYTES = UNIFORM_BYTES,
  SELECTION_WORKGROUP = WORKGROUP;

/**
 * `cameraStretch` is the camera half of the cut's object-to-view stretch.
 *
 * `view` and `planes` are those of the render frame, and `cameraWorld` — the eye's world
 * position, ancestors resolved — is its ORIGIN: that is what the kernel's world matrices have
 * already lost. The camera is therefore at zero in the frame the kernel works in, and this
 * triplet only names that frame for a sample or an oracle.
 */
export type SelectionUniforms = {
  planes: Float32Array;
  view: Float32Array;
  pixelScale: [number, number];
  pixelError: number;
  near: number;
  cameraWorld: [number, number, number];
  cameraStretch?: number;
};
export type SelectionResult = {
  pageIds: number[];
  /** Priority of each request, at the same rank as `pageIds`: the replacement's screen error,
   *  quantized (`gpuDagRequest.ts`). Only the ORACLE publishes it, for the correctness bench that
   *  compares the two rankings; the GPU path returns only the order, which is what the host consumes. */
  requestPriorities?: number[];
  frustumRejected: number;
  lodLevel: number;
  complete?: boolean;
  drawablePageIds?: number[];
  /** Triangle totals HELD BY THE GPU, where the verdict is given: the whole cut, what goes to
   *  draw, the hole — a wanted cluster whose bytes or row are missing — and the blend share.
   *  `selected − drawn − uncovered = 0`. */
  selectedTriangles?: number;
  drawnTriangles?: number;
  uncoveredTriangles?: number;
  transparentTriangles?: number;
  /** True when the cut exceeded the sample cap: the lists are truncated, and the frame must go
   *  back through the CPU cut rather than adopt them (`gpuDagLayout.ts`). */
  truncated?: boolean;
};
export type GpuCut = { uniforms: SelectionUniforms; result: SelectionResult };
/**
 * Pages whose residency flag just changed, in increasing order. `sorted` false means the list
 * no longer describes the set: the reader then starts over from every page.
 */
export type ResidencyChanges = { pages: Int32Array; count: number; sorted: boolean };
/** Told `true` when the shared command buffer reached the queue, `false` when the image dropped it. */
export type SelectionSubmission = (submitted: boolean) => void;
export type GpuSelection = {
  readonly residentCut: boolean;
  readonly maskBuffer: GPUBuffer;
  /** Index in u32 words of the current-frame drawable page mask. */
  readonly maskOffset: number;
  readonly pageCount: number;
  updateWorlds(worldMatrices: Float32Array): boolean;
  updateResidency(resident: Uint32Array, changes?: ResidencyChanges): boolean;
  /**
   * Encodes the selection. Given `shared`, the caller owns the command buffer — one image submits one
   * buffer — and takes back the settlement it must call: `true` once that buffer is on the queue,
   * `false` when the image abandons it. Nothing is read back before the settlement says submitted.
   */
  dispatch(
    uniforms: SelectionUniforms,
    shared?: GPUCommandEncoder,
  ): SelectionSubmission | undefined;
  peek(): GpuCut | null;
  failed(): boolean;
  flush(): Promise<SelectionResult | null>;
  dispose(): void;
};

const planeScratch = new Float32Array(FRUSTUM_PLANE_VALUES),
  viewScratch = new Float32Array(16);

/** Uniform block of a cut, allocated once: the frame rewrites it, it does not remake it. */
export function createSelectionUniforms(): SelectionUniforms {
  return {
    planes: new Float32Array(FRUSTUM_PLANE_VALUES),
    view: new Float32Array(16),
    pixelScale: [1, 1],
    pixelError: 0,
    near: 0.1,
    cameraWorld: [0, 0, 0],
  };
}

export function sameSelectionUniforms(a: SelectionUniforms, b: SelectionUniforms) {
  if (
    a.pixelError !== b.pixelError ||
    a.near !== b.near ||
    a.pixelScale[0] !== b.pixelScale[0] ||
    a.pixelScale[1] !== b.pixelScale[1]
  )
    return false;
  if (
    a.cameraWorld[0] !== b.cameraWorld[0] ||
    a.cameraWorld[1] !== b.cameraWorld[1] ||
    a.cameraWorld[2] !== b.cameraWorld[2]
  )
    return false;
  if (!sameElements(a.view, b.view)) return false;
  for (let i = 0; i < 24; i++) if (a.planes[i] !== b.planes[i]) return false;
  return true;
}

export function copySelectionUniforms(source: SelectionUniforms): SelectionUniforms {
  return {
    planes: source.planes.slice(),
    view: source.view.slice(),
    pixelScale: [source.pixelScale[0], source.pixelScale[1]],
    pixelError: source.pixelError,
    near: source.near,
    cameraWorld: [source.cameraWorld[0], source.cameraWorld[1], source.cameraWorld[2]],
    cameraStretch: source.cameraStretch,
  };
}

export function leafCone(page: {
  cone?: NormalCone;
  material?: THREE.Material | THREE.Material[];
}): NormalCone {
  const material = page.material;
  if (material) {
    const side = Array.isArray(material) ? material[0]?.side : material.side;
    if (side === THREE.DoubleSide || side === THREE.BackSide) return OPEN_CONE;
  }
  return page.cone ?? OPEN_CONE;
}

export function cameraSelectionUniforms(
  cam: EngineCamera,
  pixelError: number,
  viewport?: [number, number],
  into?: SelectionUniforms,
): SelectionUniforms {
  const planes = into?.planes ?? planeScratch;
  const view = into?.view ?? viewScratch;
  // View and planes are those of the RENDER FRAME (`cameraRenderOrigin.ts`): the kernel composes
  // `view · world` in single precision, and the world matrices given to it are brought back to
  // `cameraWorld`. Taking the absolute view here would mix the two frames in the same formula.
  // Ancestors included: the frame entry set both halves once in the engine camera.
  // Single precision only rounds here, as before: everything above is computed in double.
  planes.set(cam.planesRelative);
  view.set(cam.viewRelative);
  const pixelScale = pixelScaleOf(
    cam.projection,
    viewport,
    into?.pixelScale ?? ([1, 1] as [number, number]),
  );
  const position = cam.eye;
  const cameraWorld: [number, number, number] = into?.cameraWorld ?? [
    position[0],
    position[1],
    position[2],
  ];
  cameraWorld[0] = position[0];
  cameraWorld[1] = position[1];
  cameraWorld[2] = position[2];
  // The flat cut multiplies this by each primitive's own stretch, exactly like `selectVisiblePages`.
  // Stretch reads only the linear part, which the render frame does not touch: same bits.
  const cameraStretch = maxStretch(cam.viewRelative);
  if (into) {
    into.pixelError = pixelError;
    into.near = cam.near;
    into.cameraWorld = cameraWorld;
    into.cameraStretch = cameraStretch;
    return into;
  }
  return {
    planes: planes.slice(),
    view: view.slice(),
    pixelScale: [pixelScale[0], pixelScale[1]],
    pixelError,
    near: cam.near,
    cameraWorld: [cameraWorld[0], cameraWorld[1], cameraWorld[2]],
    cameraStretch,
  };
}
