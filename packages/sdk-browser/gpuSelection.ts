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
import { pixelScaleOf } from './streamingPriority.ts';
import type { EngineCamera } from './cameraWorld.ts';

const NONE = 0xffffffff,
  UNIFORM_BYTES = 256,
  WORKGROUP = 64;
/** Floats per cluster in the shared cone/box/residency record read by every kernel. */
export const PAGE_CONE_FLOATS = 12,
  SELECTION_NONE = NONE,
  SELECTION_UNIFORM_BYTES = UNIFORM_BYTES,
  SELECTION_WORKGROUP = WORKGROUP;

/**
 * `cameraStretch` is the camera half of the cut's object-to-view stretch.
 *
 * `view` et `planes` sont ceux du repère de rendu, et `cameraWorld` — la position monde de l'œil,
 * ancêtres résolus — en est l'ORIGINE : c'est elle que les matrices monde du noyau ont déjà perdue.
 * La caméra est donc à zéro dans le repère où le noyau travaille, et ce triplet ne sert plus qu'à
 * nommer ce repère pour un relevé ou un oracle.
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
  frustumRejected: number;
  lodLevel: number;
  complete?: boolean;
  drawablePageIds?: number[];
};
export type GpuCut = { uniforms: SelectionUniforms; result: SelectionResult };
/**
 * Les pages dont le drapeau de résidence vient de changer, dans l'ordre croissant. `sorted` faux dit
 * que la liste ne décrit plus l'ensemble : le lecteur repart alors de toutes les pages.
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

/** Le bloc d'uniformes d'une coupe, alloué une fois : l'image le réécrit, elle ne le refait pas. */
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
  cam: EngineCamera,
  pixelError: number,
  viewport?: [number, number],
  into?: SelectionUniforms,
): SelectionUniforms {
  const planes = into?.planes ?? planeScratch;
  const view = into?.view ?? viewScratch;
  // Vue et plans sont ceux du REPÈRE DE RENDU (`cameraRenderOrigin.ts`) : le noyau compose
  // `vue · monde` en simple précision, et les matrices monde qu'on lui donne sont ramenées à
  // `cameraWorld`. Prendre ici la vue absolue mélangerait les deux repères dans la même formule.
  // Ancêtres compris : l'entrée d'image a posé les deux moitiés une fois dans la caméra du moteur.
  // La simple précision n'arrondit qu'ici, comme avant : tout est calculé en double au-dessus.
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
  // L'étirement ne lit que la partie linéaire, que le repère de rendu ne touche pas : mêmes bits.
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
