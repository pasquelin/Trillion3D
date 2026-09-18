import * as THREE from 'three';
import type { NormalCone } from './pageCone.ts';
import type { CullingLinks } from './pageSelectionCutForced.ts';

export type PageRec = {
  id: number;
  url: string;
  clusterId: string;
  array?: Uint32Array;
  triangles: number;
  indexBytes: number;
  min: number[];
  max: number[];
  role?: 'exact' | 'coarse';
  /** Flat DAG cut, copied from the page. Absent on caches without a per-cluster error. */
  level?: number;
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  /** Group that replaces this cluster, and group that produced it. */
  group?: number | null;
  source?: number | null;
  /** Streaming bundle that carries this cluster, and its byte offset inside it. Residency is a
   *  property of the bundle: one request makes dozens of clusters drawable at once. */
  streamUrl?: string;
  streamOffset?: number;
  /** Coplanar depth layer, 0 for every cluster the compiler left alone. Always present, never
   *  undefined, so a page record keeps one shape through the selection loop. */
  depthLayer: number;
  attributes: THREE.BufferGeometry['attributes'];
  material: THREE.Material | THREE.Material[];
  transparent?: boolean;
  sourceMesh?: THREE.Mesh;
  sourceOrder?: number;
  matrix: THREE.Matrix4;
  /** Sens de parcours mémorisé et époque de la matrice monde qui l'a donné (`webgpuPagesWinding`). */
  windingCw?: boolean;
  windingEpoch?: number;
  renderOrder: number;
  geometry?: THREE.BufferGeometry;
  mesh?: THREE.Mesh;
  attached: boolean;
  resident?: boolean;
  cone?: NormalCone;
  /** Rang de la clé de requête, posé une fois par `indexPageRequests` : dédoublonnage sans hachage. */
  requestIndex?: number;
  /** Rang de la clé de cluster dans le catalogue de l'hôte, posé une fois : résidence et épinglage sans
   *  hachage. L'hôte le pose, personne d'autre ne le lit. */
  keyIndex?: number;
  /** Rang de la page dans le catalogue empaqueté d'un moteur WebGPU, posé une fois. Un autre moteur
   *  qui le réécrit ne trompe personne : le lecteur vérifie que le catalogue rend bien cette page. */
  packedIndex?: number;
  /** Rang de la racine — le placement — dans les racines de sélection d'un moteur WebGPU, posé une
   *  fois par sa disposition : c'est ce que la fiche porte pour retrouver le mouvement du placement. */
  placementIndex?: number;
};
/**
 * Group links of a primitive, flattened once and shared by every instance of it.
 *
 * `children` and `outputs` of a group cover the same surface, never both at once, so replacing one
 * by the other is always a complete swap. `sources` and `owners` say, for a cluster, which group
 * produced it and which group replaces it.
 */
export type ClusterStructureIndex = {
  groupCount: number;
  childOffsets: Int32Array;
  children: Int32Array;
  outputOffsets: Int32Array;
  outputs: Int32Array;
  sources: Int32Array;
  owners: Int32Array;
  error: Float64Array;
  sphere: Float64Array;
  roots: readonly number[];
};
/**
 * One primitive instance as the selection sees it: its clusters, the world matrix that places them,
 * its flat culling hierarchy and its group links. There is no tree — every cluster carries its own
 * screen-error band, and the hierarchy is only a traversal accelerator.
 */
export type ClusterRoot<T> = {
  world: THREE.Matrix4;
  pages: T[];
  /** `bounds` : bornes par nœud dérivées des nœuds et des pages, une fois à la préparation.
   *  `links` : parent de chaque nœud et nœud feuille de chaque cluster, même préparation partagée.
   *  `marks` : les nœuds que le forçage touche, propres à ce placement et remis à zéro par image. */
  culling?: {
    nodes: Float64Array;
    stride: number;
    bounds: Float64Array;
    links?: CullingLinks;
    marks?: Int32Array;
  };
  /** Boîte monde de la racine, six bornes à plat (`mathBox.ts`). */
  worldBox?: Float64Array;
  /** La boîte locale dont `worldBox` est l'image : ce qu'un déplacement de nœud reprojette (R8). */
  localBox?: Float64Array;
  stretch?: number;
  stretchKey?: Float64Array;
  structure?: ClusterStructureIndex;
  forced?: Uint8Array;
  forcedList?: number[];
  /** Ce que la racine déclare de ses cônes de normales, une fois pour toutes à la préparation :
   *  `false` dit qu'aucune de ses pages n'en porte, et la coupe cesse alors de lire `cone` par
   *  cluster. Absent ou `true`, la coupe teste chaque page comme avant. Qui pose un cône sur une
   *  page pose ce drapeau sur sa racine : c'est le seul contrat qui rend l'omission visible. */
  cones?: boolean;
  /** Ce que la racine déclare des boîtes de ses pages, une fois pour toutes à la préparation :
   *  `true` dit que chacune porte `min` et `max`, et la coupe cesse alors de s'en assurer par
   *  cluster sous un nœud entièrement dans le tronc. Absent ou `false`, elle teste chaque page
   *  comme avant. Qui construit une page sans boîte ne déclare rien : c'est le seul contrat qui
   *  rend l'omission visible. */
  boxes?: boolean;
};

/**
 * Tours de montée vers un ancêtre résident avant que la couverture racine épinglée ne prenne le
 * relais. La coupe plate et la coupe du DAG de clusters escaladent le même nombre de fois : deux
 * valeurs séparées se seraient réglées l'une sans l'autre.
 */
export const ESCALATION_ROUNDS = 3;

/**
 * Marge relative ajoutée au seuil quand la coupe monte vers un ancêtre résident.
 *
 * L'escalade pose `seuil = erreur écran du parent` pour que le cluster absent cesse d'être retenu
 * (`erreur parent > seuil` devient faux à l'égalité) et que son parent le remplace (`erreur parent
 * <= seuil` vrai à la même égalité). Les deux bascules tiennent donc sur une égalité EXACTE entre
 * une valeur écrite par une passe et la même valeur recalculée par une autre. En f32 cette égalité
 * ne tient pas : le compilateur du pilote contracte les mêmes opérandes différemment d'un point
 * d'entrée à l'autre, et la valeur relue dérive de quelques unités du dernier bit — le cluster
 * absent redevient retenu, et son parent ne le remplace pas. Le seuil est donc posé strictement
 * au-dessus, d'une marge qui couvre largement cette dérive tout en restant quatre ordres de
 * grandeur sous le pixel : les deux bascules deviennent strictes.
 */
export const ESCALATION_SLACK = 1 + 2 ** -14;
