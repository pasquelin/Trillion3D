/**
 * The contract every GPU selection kernel honours, and the camera state it reads.
 *
 * The runtime has one kernel, `gpuDagSelection`: a cluster DAG where each cluster carries its own
 * screen-error band. This module holds what is common to a kernel and its callers — the uniform
 * block, the readback shape and the page-cone convention — so neither side owns the other.
 */
import { maxStretch } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { OPEN_CONE, type NormalCone } from './pageCone.ts';

const NONE = 0xffffffff,
  UNIFORM_BYTES = 256,
  WORKGROUP = 64;
/** Floats per cluster in the shared cone/box/residency record read by every kernel. */
export const PAGE_CONE_FLOATS = 12,
  SELECTION_NONE = NONE,
  SELECTION_UNIFORM_BYTES = UNIFORM_BYTES,
  SELECTION_WORKGROUP = WORKGROUP;

/** `cameraStretch` is the camera half of the cut's object-to-view stretch. */
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
  frustumRejected: number;
  lodLevel: number;
  complete?: boolean;
  drawablePageIds?: number[];
};
export type GpuCut = { uniforms: SelectionUniforms; result: SelectionResult };
/** Told `true` when the shared command buffer reached the queue, `false` when the image dropped it. */
export type SelectionSubmission = (submitted: boolean) => void;
export type GpuSelection = {
  readonly residentCut: boolean;
  readonly maskBuffer: GPUBuffer;
  /** Index in u32 words of the current-frame drawable page mask. */
  readonly maskOffset: number;
  readonly pageCount: number;
  updateWorlds(worldMatrices: Float32Array): boolean;
  updateResidency(resident: Uint32Array): boolean;
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

const scratch = {
  vp: new THREE.Matrix4(),
  frustum: new THREE.Frustum(),
  camPos: new THREE.Vector3(),
};
const planeScratch = new Float32Array(24),
  viewScratch = new Float32Array(16);

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
  for (let i = 0; i < 16; i++) if (a.view[i] !== b.view[i]) return false;
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
  camera: THREE.PerspectiveCamera,
  pixelError: number,
  viewport?: [number, number],
  into?: SelectionUniforms,
): SelectionUniforms {
  camera.updateMatrixWorld();
  const { vp, frustum, camPos } = scratch;
  frustum.setFromProjectionMatrix(
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  const planes = into?.planes ?? planeScratch;
  const view = into?.view ?? viewScratch;
  for (let i = 0; i < 6; i++) {
    const plane = frustum.planes[i];
    planes[i * 4] = plane.normal.x;
    planes[i * 4 + 1] = plane.normal.y;
    planes[i * 4 + 2] = plane.normal.z;
    planes[i * 4 + 3] = plane.constant;
  }
  view.set(camera.matrixWorldInverse.elements);
  const width = viewport?.[0] ?? 1,
    height = viewport?.[1] ?? 1;
  const pixelScale: [number, number] = into?.pixelScale ?? [1, 1];
  pixelScale[0] = (width * Math.abs(camera.projectionMatrix.elements[0])) / 2;
  pixelScale[1] = (height * Math.abs(camera.projectionMatrix.elements[5])) / 2;
  camera.getWorldPosition(camPos);
  const cameraWorld: [number, number, number] = into?.cameraWorld ?? [camPos.x, camPos.y, camPos.z];
  cameraWorld[0] = camPos.x;
  cameraWorld[1] = camPos.y;
  cameraWorld[2] = camPos.z;
  // The flat cut multiplies this by each primitive's own stretch, exactly like `selectVisiblePages`.
  const cameraStretch = maxStretch(camera.matrixWorldInverse.elements);
  if (into) {
    into.pixelError = pixelError;
    into.near = camera.near;
    into.cameraWorld = cameraWorld;
    into.cameraStretch = cameraStretch;
    return into;
  }
  return {
    planes: planes.slice(),
    view: view.slice(),
    pixelScale: [pixelScale[0], pixelScale[1]],
    pixelError,
    near: camera.near,
    cameraWorld: [cameraWorld[0], cameraWorld[1], cameraWorld[2]],
    cameraStretch,
  };
}
