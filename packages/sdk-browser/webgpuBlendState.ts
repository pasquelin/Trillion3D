import * as THREE from 'three';
import { FRUSTUM_PLANE_VALUES, type DiagnosticMode } from '../sdk-core/index.ts';
import type { BlendLighting } from './webgpuBindEntries.ts';
import type { BlendOverdraw } from './webgpuBlendOverdraw.ts';
import type { TransparentCompaction } from './webgpuTransparentCompact.ts';
import type { TransparentOcclusion } from './gpuTransparentOcclusion.ts';
import type { TransparentTable } from './webgpuTransparentTable.ts';
import type { BlendExpand } from './webgpuBlendExpand.ts';
import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';

export type BlendGpuItem = {
  /** Le matériau transmet : l'item est dessiné dans la passe de transmission, pas dans le mélange. */
  transmissive?: boolean;
  position: GPUBuffer;
  /** Own index buffer of an unpaged primitive; a paged one reads the page cache instead. */
  index?: GPUBuffer;
  uv?: GPUBuffer;
  normal?: GPUBuffer;
  material: THREE.Material | THREE.Material[];
  count: number;
  matrix: THREE.Matrix4;
  sourceMesh?: THREE.Mesh;
  sourceGeometry: THREE.BufferGeometry;
  /** Boîte monde de l'item, six bornes à plat (`mathBox.ts`) ; absente, l'item n'est pas rejeté. */
  bounds?: Float64Array;
  /** Le tampon que cette boîte occupe, alloué une fois pour l'item quand il est rejetable par le
   *  tronc. Absent, l'item n'a jamais de boîte ; présent, `bounds` le désigne ou vaut `undefined`
   *  parce que les bornes obtenues n'étaient pas exploitables (`webgpuBlendWorlds.ts`). */
  worldBox?: Float64Array;
  rgba: [number, number, number, number];
  map?: THREE.Texture;
  flags: number;
  /** L'adressage des six cartes du matériau, un quartet chacune (`visibilityWrapModes.ts`). */
  wrapModes: number;
  group?: GPUBindGroup;
  paged?: boolean;
  /** Rank of a paged item in the transparent table: the base its instances are written at. */
  pagedIndex?: number;
  /** Base de sa liste de grappes dans la table transparente, zero pour un item non pagine. */
  tableBase?: number;
  /** Premier sommet de sa geometrie dans les tampons concatenes, zero pour un item non pagine. */
  vertexBase?: number;
  /** Carré de la distance de l'œil au centre de sa boîte monde, reposé à chaque image, et son rang
   *  source, qui départage les clés égales (`webgpuBlendOrder.ts`). Obligatoires : `refreshEyeKeys`
   *  les pose sur tous les items avant tout tri, et le comparateur lit un nombre, jamais un
   *  peut-être — une valeur défaussée classerait un item « à l'œil » au lieu de se voir. */
  orderKey: number;
  orderRank: number;
};

/** Reused transparent draw lists and GPU resources for one backend instance. */
export function createWebgpuBlendState() {
  /** Les mots de l'uniforme de vue, alloués une fois. */
  const view = new Float32Array(BLEND_VIEW_SIZE / 4);
  const blendGpu: BlendGpuItem[] = [];
  const pagedBlendGpu = new Map<THREE.Mesh, BlendGpuItem>();
  const visibleBlend: BlendGpuItem[] = [];
  const state = {
    blendGpu,
    pagedBlendGpu,
    visibleBlend,
    /** Plans normalisés du tronc de l'image, contre lesquels un item est rejeté. */
    blendPlanes: new Float64Array(FRUSTUM_PLANE_VALUES),
    /** The scene's transparent draw order and the GPU compaction that filters it, or undefined
     *  before `prepare` built them — or when the scene carries no paged transparent cluster. */
    table: undefined as TransparentTable | undefined,
    compaction: undefined as TransparentCompaction | undefined,
    /** Le test Hi-Z des grappes transparentes, monté après la pyramide dont il dépend. */
    occlusion: undefined as TransparentOcclusion | undefined,
    /** Les coins monde de chaque entrée de la table, et l'âge de la table dont ils sortent. */
    occlusionCorners: new Float32Array(0) as Float32Array<ArrayBuffer>,
    occlusionEpoch: -1,
    /** Instances a CPU cut wrote, and the meshes it selected. */
    cpuInstances: new Uint32Array(0),
    cpuInstanceCount: 0,
    cpuSelectedMeshes: new Set<THREE.Mesh>(),
    /** Table entries changed by the residency journal, awaiting a partial upload. */
    dirtySpans: new Set<number>(),
    /** Instances each item drew this image; only a CPU cut counts them, a GPU cut does not. */
    cpuItemCounts: new Uint32Array(0),
    /** Les ressources d'éclairage sur lesquelles les groupes de liaison courants ont été bâtis :
     *  l'atlas d'ombres et la grille de sondes n'arrivent qu'après les premières images. */
    lighting: undefined as BlendLighting | undefined,
    /** Combien d'items transparents transmettent : zéro veut dire qu'aucune copie de fond n'est
     *  allouée ni encodée, et que la passe de transmission n'existe pas de l'image. */
    transmissive: 0,
    /** Le volume de chaque item de la liste de dessin, à l'écriture des uniformes. */
    volumePacked: new Float32Array(0) as Float32Array<ArrayBuffer>,
    /** Per-catalogue-entry cluster identity, and the mode it was written for. */
    clusterIdentity: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    diagnosticMode: undefined as DiagnosticMode | undefined,
    /** Le compteur de surdessin, monté par la seule variante de diagnostic qui le demande. */
    overdraw: undefined as BlendOverdraw | undefined,
    /** Les fiches d'items et l'uniforme de vue : un tampon de scène, un tampon d'image. */
    itemBuffer: undefined as GPUBuffer | undefined,
    itemPacked: new Float32Array(0) as Float32Array<ArrayBuffer>,
    /** La vue entière des fiches, sur le même tampon : allouée avec elles, jamais par image. */
    itemInts: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    viewBuffer: undefined as GPUBuffer | undefined,
    viewPacked: view,
    viewInts: new Uint32Array(view.buffer),
    /** Le noyau qui étale le plan trié, et les deux tampons qu'il — ou son repli — écrit : la liste
     *  d'instances que le nuanceur lit, et un argument indirect par tranche. */
    expand: undefined as BlendExpand | undefined,
    expandedBuffer: undefined as GPUBuffer | undefined,
    expandedPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    argsBuffer: undefined as GPUBuffer | undefined,
    argsPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** Ce que l'indice de sommet décale pour nommer la première instance de sa tranche, et les
     *  sommets d'une grappe paginée — le pas de toutes les tranches partagées. */
    vertexShift: 2,
    maxVertexWords: 3,
    /** Les instances que la scène peut étaler, et où chaque passe commence les siennes. */
    instanceCapacity: 1,
    instanceBase: [0, 0],
    /** Les entrées de plan qu'une passe peut porter au plus, et les régions que chacune occupe dans
     *  le tampon de plan, de tranches et d'arguments (`webgpuBlendExpand.ts`). */
    maxPlanEntries: 1,
    planRegions: [] as { order: number; runs: number; args: number }[],
    /** Un bit par item : le verdict du tronc de l'image, posé avec les clés de classement, et
     *  vrai tant qu'un mot du masque a changé depuis la dernière écriture sur la carte. */
    keepPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    keepMoved: true,
    /** Tables statiques du plan d'encodage (`webgpuBlendPlan.ts`). */
    drawsPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** Les entrées semées de chaque passe : le mélange, puis la transmission. Comme `runCount`,
     *  `orderMoved` et `planRegions`, tout ce qui va par passe est indexé par la passe. */
    /** Les mêmes entrées, dans l'ordre de peinture de l'image : du plus lointain au plus proche.
     *  Semées par le plan, réordonnées sur place à chaque image (`webgpuBlendOrder.ts`). */
    orders: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    /** Les tranches de chaque ordre, refaites — et réécrites sur la carte — quand il a bougé. */
    runs: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    runCount: [0, 0],
    /** L'ordre a-t-il bougé depuis la dernière écriture ? Une pose immobile n'écrit rien. */
    orderMoved: [true, true],
    /** Triangles que les items non paginés soumettent dans chaque passe, deux fois pour un item
     *  double face : un compte de scène, bâti avec le plan, et non un compte d'image. */
    blendTriangles: 0,
    transmissionTriangles: 0,
    /** Le groupe de liaison que TOUS les items paginés partagent. */
    pagedGroup: undefined as GPUBindGroup | undefined,
  };
  return state;
}
