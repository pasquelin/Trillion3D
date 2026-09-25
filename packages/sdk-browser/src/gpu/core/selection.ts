/**
 * The contract every GPU selection kernel honours, and the camera state it reads.
 *
 * The runtime has one kernel, `gpuDagSelection`: a cluster DAG where each cluster carries its own
 * screen-error band. This module holds what is common to a kernel and its callers — the uniform
 * block, the readback shape and the page-cone convention — so neither side owns the other.
 */
import { FRUSTUM_PLANE_VALUES, maxStretch } from '../../../../sdk-core/src/index.ts';
import { sameElements } from '../../math/matrixElements.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';
import type { CameraMotion, EngineCamera } from '../../camera/world.ts';
import { aheadViewOf, copyAheadView, sameAheadView, type AheadView } from './aheadView.ts';

const NONE = 0xffffffff,
  UNIFORM_BYTES = 256,
  WORKGROUP = 64;
/** Words per cluster of the shared cold record — cone, box, owning node, triangles.
 *  Public mirror of `COLD_WORDS` (`../dag/layout.ts`), which is its only source. */
export const PAGE_CONE_FLOATS = 13,
  SELECTION_NONE = NONE,
  SELECTION_UNIFORM_BYTES = UNIFORM_BYTES,
  SELECTION_WORKGROUP = WORKGROUP;

/**
 * `cameraStretch` is the camera half of the cut's object-to-view stretch, `perspective` the
 * projection's clip-w weight (`EngineCamera.perspective`), 1 when absent. `view` and `planes` are
 * those of the render frame, and `cameraWorld` — the eye's world position, ancestors resolved — is
 * its ORIGIN: the camera is at zero in the frame the kernel works in, and this triplet only names
 * that frame for a sample or an oracle.
 */
export type SelectionUniforms = {
  planes: Float32Array;
  view: Float32Array;
  pixelScale: [number, number];
  pixelError: number;
  near: number;
  cameraWorld: [number, number, number];
  cameraStretch?: number;
  perspective?: number;
  /** The view ahead of a moving camera (`./aheadView.ts`); absent or null for a still one. */
  ahead?: AheadView | null;
};
export type SelectionResult = {
  pageIds: number[];
  /** Requests of the view ahead, ranked as `pageIds` and after all of them (`../dag/request.ts`). */
  aheadPageIds?: number[];
  /** Priority of each request, at the same rank as `pageIds` (`../dag/request.ts`). Only the ORACLE
   *  publishes it, for the bench that compares the two rankings; the GPU returns only the order. */
  requestPriorities?: number[];
  frustumRejected: number;
  lodLevel: number;
  drawablePageIds?: number[];
  /** Triangle totals HELD BY THE GPU, where the verdict is given: what the cut rule draws — one
   *  counter, read as both `selected` and `drawn` — and its blend share. The only source of these
   *  totals: the CPU sums none. */
  selectedTriangles: number;
  drawnTriangles: number;
  transparentTriangles: number;
  /** True when the cut exceeded the sample cap: the lists are truncated, and the frame must go
   *  back through the CPU cut rather than adopt them (`../dag/layout.ts`). */
  truncated?: boolean;
};
/** A readback and its uniforms (`../../webgpu/cut/adoption.ts`). */
export type GpuCut = {
  uniforms: SelectionUniforms;
  result: SelectionResult;
  /** Pose revision it was cut under: behind the selection's, it streams, counts, holds no image. */
  worldRevision: number;
};
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
  /** Bytes of its host tables, sized by the placements' pages: the CPU budget holds them. */
  readonly hostBytes: number;
  readonly worldRevision: number;
  /** Advances `worldRevision` unless `posesMoved` is false: only the render origin moved. */
  updateWorlds(worldMatrices: Float32Array, posesMoved?: boolean): boolean;
  /** Parks placement `world` — its root enters no descent queue — or takes it back. */
  parkWorld(world: number, parked: boolean): void;
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
    (a.perspective ?? 1) !== (b.perspective ?? 1) ||
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
  if (!sameElements(a.view, b.view) || !sameAheadView(a.ahead, b.ahead)) return false;
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
    perspective: source.perspective,
    ahead: copyAheadView(source.ahead),
  };
}

export function cameraSelectionUniforms(
  cam: EngineCamera,
  pixelError: number,
  viewport?: [number, number],
  into?: SelectionUniforms,
  /** The camera's motion: given, a moving camera also sends its view ahead. */
  motion?: CameraMotion,
): SelectionUniforms {
  const planes = into?.planes ?? planeScratch;
  const view = into?.view ?? viewScratch;
  // View and planes are those of the RENDER FRAME (`../../camera/renderOrigin.ts`): the kernel composes
  // `view · world` in single precision on world matrices brought back to `cameraWorld`; the absolute
  // view would mix two frames. Single precision only rounds here: everything above is in double.
  planes.set(cam.planesRelative);
  view.set(cam.viewRelative);
  const pixelScale = pixelScaleOf(
    cam.projection,
    viewport,
    into?.pixelScale ?? ([1, 1] as [number, number]),
  );
  const position = cam.eye;
  const cameraWorld: [number, number, number] = into?.cameraWorld ?? [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) cameraWorld[axis] = position[axis];
  // Times each primitive's own stretch, as `selectVisiblePages`; the render frame keeps its bits.
  const cameraStretch = maxStretch(cam.viewRelative);
  if (into) {
    into.pixelError = pixelError;
    into.near = cam.near;
    into.cameraWorld = cameraWorld;
    into.cameraStretch = cameraStretch;
    into.perspective = cam.perspective;
    into.ahead = motion ? aheadViewOf(cam, motion, into.ahead) : null;
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
    perspective: cam.perspective,
    ahead: motion ? aheadViewOf(cam, motion) : null,
  };
}
