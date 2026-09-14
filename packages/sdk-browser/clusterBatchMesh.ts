import * as THREE from 'three';
import { DrawRanges } from './clusterBatchRange.ts';

/** Matrice identité unique partagée : le lot ne transporte aucune transformation, la matrice monde reste celle de l'objet. */
export function identityMatrixTexture() {
  const data = new Float32Array(4 * 4 * 4);
  data.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const texture = new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}
/** Table d'indirection nulle : tous les sous-dessins pointent la seule matrice du lot. */
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
 * Objet de dessin d'un groupe. `isBatchedMesh` fait passer Three.js par `renderMultiDraw` (ou sa boucle
 * de repli quand `WEBGL_multi_draw` manque) ; la matrice de lot étant l'identité, la transformation des
 * sommets reste exactement `modelViewMatrix * position`, comme avec un THREE.Mesh ordinaire.
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
  /** Three.js lit `colorTexture` sans souligné : laissé indéfini, il recompilerait la clé de programme à chaque dessin. */
  colorTexture: THREE.DataTexture | null = null;
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
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;
  }
}

type ShaderParameters = { vertexShader: string; extensionMultiDraw?: boolean };
export type ShaderHook = (parameters: ShaderParameters, renderer: THREE.WebGLRenderer) => void;
const UNDEF_BATCHING = '#undef USE_BATCHING\n';
/** Annule USE_BATCHING : le vertex shader compilé redevient celui d'un THREE.Mesh ordinaire. */
export function neutraliseBatchingShader(
  material: THREE.Material,
  restore: Map<THREE.Material, ShaderHook>,
) {
  if (restore.has(material)) return;
  const previous = material.onBeforeCompile as ShaderHook;
  restore.set(material, previous);
  // Clé figée une fois pour toutes : Three.js la redemande à chaque matériau et à chaque image.
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
 * Three.js dessine un matériau transparent double face en deux passes : il bascule `side` sur
 * `BackSide` puis `FrontSide` et pose `needsUpdate` avant chacune. Or `needsUpdate` incrémente la
 * version du matériau, ce qui invalide le programme retenu : à l'objet suivant qui partage ce
 * matériau, `setProgram` recalcule l'intégralité des paramètres de programme et leur clé. Le coût est
 * donc de deux recalculs complets par objet transparent et par image.
 *
 * Les deux passes sont figées ici en deux matériaux (dos, puis face) et deux groupes de géométrie :
 * Three.js émet les deux mêmes dessins, dans le même ordre, avec les mêmes programmes et le même état
 * GL, mais ne touche plus à `side` ni à la version. Rien d'autre ne change : même objet, même
 * `renderOrder`, même tri, même mélange.
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
