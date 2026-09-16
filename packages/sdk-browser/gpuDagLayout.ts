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
export const COLD_WORDS = 12;
export const CLUSTER_ROOT = 1,
  CLUSTER_NEVER = 2;
/** Le niveau de détail voyage dans les bits hauts des drapeaux : une seule passe le lit, à l'émission. */
export const CLUSTER_LEVEL_SHIFT = 8;
const CLUSTER_LEVEL_MAX = 0xffffff;

export function packClusterFlags(root: boolean, never: boolean, level: number) {
  const bounded = Math.min(Math.max(Math.trunc(level) || 0, 0), CLUSTER_LEVEL_MAX);
  return (
    ((root ? CLUSTER_ROOT : 0) | (never ? CLUSTER_NEVER : 0) | (bounded << CLUSTER_LEVEL_SHIFT)) >>>
    0
  );
}
export const clusterLevel = (flags: number) => flags >>> CLUSTER_LEVEL_SHIFT;

/** Premier mot de la résidence, derrière l'enregistrement froid de toutes les grappes. */
export const residentBase = (pageCount: number) => pageCount * COLD_WORDS;
/** Mots de résidence : un bit par grappe, trente-deux grappes par mot. */
export const residentWords = (pageCount: number) => (Math.max(0, pageCount) + 31) >>> 5;
export const residentBit = (bits: Uint32Array, base: number, page: number) =>
  (bits[base + (page >>> 5)] & (1 << (page & 31))) !== 0;
