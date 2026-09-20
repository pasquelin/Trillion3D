import * as THREE from 'three';
import { IDENTITY_MATRIX4 } from '../sdk-core/index.ts';
import { DrawRanges } from './clusterBatchRange.ts';

/** Shared unique identity matrix: the batch carries no transform, the world matrix stays that of the object. */
export function identityMatrixTexture() {
  const data = new Float32Array(4 * 4 * 4);
  data.set(IDENTITY_MATRIX4);
  const texture = new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}
/** Null indirection table: every sub-draw points at the batch's single matrix. */
export function zeroIndirectTexture(maxDraws: number) {
  let size = 4;
  while (size * size < Math.max(1, maxDraws)) size *= 2;
  const texture = new THREE.DataTexture(
    new Uint32Array(size * size),
    size,
    size,
    THREE.RedIntegerFormat,
    THREE.UnsignedIntType,
  );
  texture.internalFormat = 'R32UI';
  texture.needsUpdate = true;
  return texture;
}

/**
 * Draw object of a group. `isBatchedMesh` sends Three.js through `renderMultiDraw` (or its
 * fallback loop when `WEBGL_multi_draw` is missing); the batch matrix being identity, vertex
 * transform stays exactly `modelViewMatrix * position`, as with an ordinary THREE.Mesh.
 */
export class ClusterDrawMesh extends THREE.Mesh {
  isBatchedMesh = true;
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount = 0;
  _multiDrawInstances: Int32Array | null = null;
  _matricesTexture: THREE.DataTexture;
  _indirectTexture: THREE.DataTexture;
  _colorsTexture: THREE.DataTexture | null = null;
  /** Three.js reads `colorTexture` without an underscore: left undefined, it would recompile the program key on every draw. */
  colorTexture: THREE.DataTexture | null = null;
  /** Exact back/front pair created by `sideSplit`; arbitrary material arrays remain unsupported. */
  _sideSplitMaterials: [THREE.Material, THREE.Material] | undefined;
  _sideSplitBack: THREE.Material | undefined;
  _sideSplitFront: THREE.Material | undefined;
  _sideSplitSource: THREE.Material | undefined;
  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    ranges: DrawRanges,
    matrices: THREE.DataTexture,
    indirect: THREE.DataTexture,
  ) {
    super(geometry, material);
    this._multiDrawStarts = ranges.starts;
    this._multiDrawCounts = ranges.counts;
    this._matricesTexture = matrices;
    this._indirectTexture = indirect;
    this._sideSplitMaterials = undefined;
    this._sideSplitBack = undefined;
    this._sideSplitFront = undefined;
    this._sideSplitSource = undefined;
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;
  }
}

type ShaderParameters = { vertexShader: string; extensionMultiDraw?: boolean };
export type ShaderHook = (parameters: ShaderParameters, renderer: THREE.WebGLRenderer) => void;
const UNDEF_BATCHING = '#undef USE_BATCHING\n';
/** Undoes USE_BATCHING: the compiled vertex shader becomes that of an ordinary THREE.Mesh again. */
export function neutraliseBatchingShader(
  material: THREE.Material,
  restore: Map<THREE.Material, ShaderHook>,
) {
  if (restore.has(material)) return;
  const previous = material.onBeforeCompile as ShaderHook;
  restore.set(material, previous);
  // Key frozen once and for all: Three.js asks for it again on every material and every frame.
  const key = material.customProgramCacheKey() + '|wgmd';
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = ((parameters: ShaderParameters, renderer: THREE.WebGLRenderer) => {
    previous?.call(material, parameters, renderer);
    parameters.extensionMultiDraw = false;
    if (!parameters.vertexShader.startsWith(UNDEF_BATCHING))
      parameters.vertexShader = UNDEF_BATCHING + parameters.vertexShader;
  }) as THREE.Material['onBeforeCompile'];
  material.needsUpdate = true;
}

/**
 * Three.js draws a two-sided transparent material in two passes: it flips `side` to
 * `BackSide` then `FrontSide` and sets `needsUpdate` before each. But `needsUpdate` bumps
 * the material version, which invalidates the retained program: on the next object that
 * shares this material, `setProgram` recomputes every program parameter and its key. The
 * cost is therefore two full recomputes per transparent object and per frame.
 *
 * The two passes are frozen here as two materials (back, then front) and two geometry
 * groups: Three.js emits the same two draws, in the same order, with the same programs and
 * the same GL state, but no longer touches `side` or the version. Nothing else changes:
 * same object, same `renderOrder`, same sort, same blending.
 */
export function sideSplit(
  material: THREE.Material | THREE.Material[],
): [THREE.Material, THREE.Material] | undefined {
  if (Array.isArray(material)) return undefined;
  if (
    material.transparent !== true ||
    material.side !== THREE.DoubleSide ||
    material.forceSinglePass === true
  )
    return undefined;
  const back = material.clone(),
    front = material.clone();
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  return [back, front];
}
