/**
 * La disposition compacte de la coupe, écrite une fois par le rangement et relue par deux lecteurs :
 * le nuanceur (`gpuDagShader.ts`, `gpuDagRecordWgsl.ts`) et l'oracle (`gpuDagOracle*.ts`). Les deux
 * passent par ce seul module, si bien qu'aucun rang de champ n'est écrit deux fois — c'est ce qui
 * garantit que l'oracle rend le même verdict que la carte graphique, au bit près.
 *
 * Deux enregistrements par grappe, séparés par ce que l'image relit :
 *
 * - le chaud (`CLUSTER_WORDS` mots, tampon `clusters`) ne porte que ce que les cinq passes d'une
 *   image lisent toutes : la sphère de la grappe et celle de son parent, les deux erreurs, la
 *   primitive et les drapeaux — niveau compris, dans leurs bits hauts ;
 * - le froid (`COLD_WORDS` mots, tampon `pageCones`) porte ce que la seule passe d'ouverture lit :
 *   le cône normal, la boîte, et l'adresse du nœud de coupe qui possède la page, dont seul l'oracle
 *   se sert pour rejouer la descente.
 *
 * La résidence prolonge le froid en bits, un mot pour trente-deux pages : les passes qui la lisent
 * n'ont plus à traverser un enregistrement de quarante-huit octets pour un seul drapeau, et l'hôte
 * n'en réécrit que les mots que ses changements touchent.
 */

/** Mots de l'enregistrement chaud ; le nuanceur déclare `struct Cluster` avec exactement ces champs. */
export const CLUSTER_WORDS = 12;
/** Mots de l'enregistrement froid ; `PAGE_CONE_FLOATS` de `gpuSelection.ts` en est le miroir public. */
const COLD_WORDS = 13;
export const CLUSTER_ROOT = 1,
  CLUSTER_NEVER = 2,
  /** La grappe est en mélange : sa part des triangles est comptée à part, comme sur le processeur. */
  CLUSTER_TRANSPARENT = 4;
/** Le niveau de détail voyage dans les bits hauts des drapeaux : une seule passe le lit, à l'émission. */
export const CLUSTER_LEVEL_SHIFT = 8;
const CLUSTER_LEVEL_MAX = 0xffffff;

export function packClusterFlags(
  root: boolean,
  never: boolean,
  level: number,
  transparent = false,
) {
  const bounded = Math.min(Math.max(Math.trunc(level) || 0, 0), CLUSTER_LEVEL_MAX);
  return (
    ((root ? CLUSTER_ROOT : 0) |
      (never ? CLUSTER_NEVER : 0) |
      (transparent ? CLUSTER_TRANSPARENT : 0) |
      (bounded << CLUSTER_LEVEL_SHIFT)) >>>
    0
  );
}
export const clusterLevel = (flags: number) => flags >>> CLUSTER_LEVEL_SHIFT;

/**
 * Le PLAFOND du relevé, en rangs, pour chacune de ses deux moitiés.
 *
 * Le tampon de relevé était taillé sur `pageCount` — le pire cas, une coupe qui retiendrait le
 * catalogue entier —, et la copie d'image en emportait la totalité : 15,2 Mo par image à 1 992 187
 * grappes, pour une coupe qui en retient de l'ordre du centième. Mesuré sur apple metal-3
 * (`bench/justesse/releve-coupe-gpu.mjs`) : 1,17 ms par image pour le relevé complet contre 0,52 ms
 * pour un relevé plafonné, quand les noyaux eux-mêmes en coûtent 0,99.
 *
 * Le plafond est LARGE devant une coupe réelle : le même banc retient 7 812 rangs de 1 992 187 à
 * seuil 64, 31 250 à seuil 16. Un dépassement reste donc possible — une caméra posée dans la
 * géométrie à seuil minuscule — et il est DIT : le noyau pose le bit de débordement, le relevé est
 * déclaré tronqué et l'image repasse par la coupe processeur, qui sait choisir un sous-ensemble
 * représentable. Jamais un relevé tronqué n'est adopté comme s'il était entier.
 */
export const SELECTION_LIST_CAP = 262144;
/** Le plafond d'une scène : jamais plus que son catalogue, qu'aucune coupe ne peut dépasser. */
export const selectionListCap = (pageCount: number) =>
  Math.min(Math.max(0, pageCount), SELECTION_LIST_CAP);

/**
 * L'entête du relevé, en mots, devant chacune de ses deux moitiés.
 *
 * Les quatre premiers sont ceux de toujours — le compte, le rejet par le tronc, le niveau atteint,
 * les drapeaux. Les quatre suivants portent les TOTAUX DE TRIANGLES, que le processeur sommait
 * jusqu'ici en parcourant la différence de coupe (`webgpuCutCounts.ts`). Ils sont tenus par les
 * noyaux, là où le verdict est prononcé : `dagWanted` sait ce que la coupe retient, `dagMask` sait
 * ce qui part au dessin et ce qui manque. Leur relation reste `selected − drawn − uncovered = 0`.
 *
 * C'est la condition pour que le relevé cesse un jour de porter des LISTES : un total tenu par la
 * carte survit à la disparition de la liste dont il était somme.
 */
export const SELECTION_HEADER_WORDS = 8;
export const OUT_COUNT = 0,
  OUT_FRUSTUM_REJECTED = 1,
  OUT_LOD_LEVEL = 2,
  OUT_FLAGS = 3,
  OUT_SELECTED_TRIANGLES = 4,
  OUT_TRANSPARENT_TRIANGLES = 5,
  OUT_DRAWN_TRIANGLES = 6,
  OUT_UNCOVERED_TRIANGLES = 7;

/** Premier mot de la résidence, derrière l'enregistrement froid de toutes les grappes. */
export const residentBase = (pageCount: number) => pageCount * COLD_WORDS;
/** Mots de résidence : un bit par grappe, trente-deux grappes par mot. */
export const residentWords = (pageCount: number) => (Math.max(0, pageCount) + 31) >>> 5;
export const residentBit = (bits: Uint32Array, base: number, page: number) =>
  (bits[base + (page >>> 5)] & (1 << (page & 31))) !== 0;

/** Rangs des champs chauds, dans l'ordre où `struct Cluster` du nuanceur les déclare. */
export const HOT_SPHERE = 0,
  HOT_PARENT_SPHERE = 4,
  HOT_LOD_ERROR = 8,
  HOT_PARENT_ERROR = 9,
  HOT_WORLD = 10,
  HOT_FLAGS = 11;
/** Rangs des champs froids, dans l'ordre où `gpuDagRecordWgsl.ts` les lit au mot. */
export const COLD_CONE = 0,
  COLD_MIN = 4,
  COLD_HAS_BOX = 7,
  COLD_MAX = 8,
  COLD_OWNER = 11,
  /** Les triangles de la grappe, lus au mot ENTIER : ce sont eux que les totaux accumulent. */
  COLD_TRIANGLES = 12;

/**
 * Les quatre vues d'un rangement : le décodeur unique que l'oracle et le double de tampon partagent.
 * Aucun rang n'est réécrit chez eux, donc aucun ne peut y diverger de celui que la carte lit.
 */
export type DagRecords = {
  hot: Float32Array;
  hotInts: Uint32Array;
  cold: Float32Array;
  coldInts: Uint32Array;
};
export function dagRecords(packed: {
  clusters: Float32Array;
  pageCones: Float32Array;
}): DagRecords {
  const { clusters, pageCones } = packed;
  return {
    hot: clusters,
    hotInts: new Uint32Array(clusters.buffer, clusters.byteOffset, clusters.length),
    cold: pageCones,
    coldInts: new Uint32Array(pageCones.buffer, pageCones.byteOffset, pageCones.length),
  };
}

export const worldOf = (r: DagRecords, i: number) => r.hotInts[i * CLUSTER_WORDS + HOT_WORLD];
export const flagsOf = (r: DagRecords, i: number) => r.hotInts[i * CLUSTER_WORDS + HOT_FLAGS];
/** Le nœud de coupe qui possède la page : au froid, car seul l'oracle rejoue la descente. */
export const ownerOf = (r: DagRecords, i: number) => r.coldInts[i * COLD_WORDS + COLD_OWNER];
export const hasBoxOf = (r: DagRecords, i: number) => r.cold[i * COLD_WORDS + COLD_HAS_BOX];
/** Les triangles de la grappe, au mot entier : `trianglesOf` du nuanceur en est le miroir. */
export const trianglesOf = (r: DagRecords, i: number) =>
  r.coldInts[i * COLD_WORDS + COLD_TRIANGLES];
/** `at` vaut 0 pour la bande de la grappe, 1 pour celle de son parent : mêmes couples qu'au nuanceur. */
export const bandError = (r: DagRecords, i: number, at: number) =>
  r.hot[i * CLUSTER_WORDS + (at === 0 ? HOT_LOD_ERROR : HOT_PARENT_ERROR)];
export const bandSphere = (r: DagRecords, i: number, at: number) =>
  i * CLUSTER_WORDS + (at === 0 ? HOT_SPHERE : HOT_PARENT_SPHERE);

export function boxInto(r: DagRecords, i: number, min: number[], max: number[]) {
  const base = i * COLD_WORDS;
  for (let a = 0; a < 3; a++) {
    min[a] = r.cold[base + COLD_MIN + a];
    max[a] = r.cold[base + COLD_MAX + a];
  }
}
export function coneInto(r: DagRecords, i: number, cone: { axis: number[]; angle: number }) {
  const base = i * COLD_WORDS + COLD_CONE;
  for (let a = 0; a < 3; a++) cone.axis[a] = r.cold[base + a];
  cone.angle = r.cold[base + 3];
}

/**
 * La colonne de résidence rendue à l'oracle, un mot par grappe : ce que les doubles de tampon lisent
 * dans le même tampon froid que le nuanceur, au lieu d'un rang recopié chez eux.
 */
export function residentFlags(bits: Uint32Array, pageCount: number) {
  const base = residentBase(pageCount);
  return Uint32Array.from({ length: pageCount }, (_, page) =>
    residentBit(bits, base, page) ? 1 : 0,
  );
}
