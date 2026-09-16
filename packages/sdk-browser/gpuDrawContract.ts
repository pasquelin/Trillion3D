import { MAX_DEPTH_LAYER } from '../sdk-core/index.ts';

export const DRAW_INDIRECT_STRIDE = 16;
export const PAGE_BIND_ALIGN = 256;
export const BIN_BACK = 0,
  BIN_NONE = 1,
  BIN_FRONT = 2;
/** Slots of one coplanar layer: three cull modes × occluder-or-tested. */
export const BASE_SLOTS = 6;
export const UNIFORM_BYTES = 32,
  WORKGROUP = 64;
/**
 * u32 par fiche de dessin : la ligne de la table de pages, son bac de pipeline, son index de page
 * dans le catalogue de sélection, sa couche coplanaire, et ses triangles. Les cinq sont des
 * propriétés de la LIGNE, jamais de l'image : la partition GPU lit les deux derniers pour compter
 * ses slots et peser un rejet d'occultation, sans qu'aucun parcours par image ne les rassemble.
 */
export const DRAW_ITEM_U32 = 5;
/**
 * Slots a compaction needs for `layerSlots` coplanar layers — one layer means the six slots this
 * path has always had, and a scene with no stacked coplanar surface asks for exactly that. Each
 * extra layer is its own set of six: its clusters are drawn by their own indirect command, with the
 * pipeline that carries their depth bias, and the clusters of layer 0 keep the order they had.
 */
export const slotCount = (layerSlots: number) => BASE_SLOTS * Math.max(1, layerSlots);
/** Slots que la compaction peut avoir à nommer : toutes les couches que le format de cache décrit.
 *  Les tableaux dimensionnés une fois pour toutes s'y réfèrent ; cela coûte quelques centaines
 *  d'octets et évite de réallouer quand une scène porte des couches. */
export const MAX_DRAW_SLOTS = slotCount(1 + MAX_DEPTH_LAYER);

export type DrawItem = {
  pageIndex: number;
  bin: 0 | 1 | 2;
  rest: 0 | 1;
  selectionIndex?: number;
  layer?: number;
  triangles?: number;
};
export type CompactResult = {
  instances: Uint32Array; // compacted pageIndex in input order
  bins: Uint32Array; // compacted bin
  rests: Uint32Array; // compacted rest flag
  counts: number[]; // (bin + 3*rest + 6*layer)
  indirect: Uint32Array; // one drawIndirect per slot, four u32 each
  overflow: boolean;
};
export type SlotLayout = {
  offsets: number[];
  rows: number[];
  tableRows: number;
};
export type GpuDraw = {
  /**
   * `items` holds `count` packed rows of {pageIndex,bin,selectionIndex,layer,triangles}. Those five
   * are properties of the page-table row and not of the frame, so only the rows `[itemsFrom,
   * itemsTo]` — the ones a page arriving, leaving or changing rank has just rewritten — travel to
   * the card; `itemsTo < itemsFrom` sends nothing. Nothing here allocates.
   *
   * La moitié occulteurs/testés de chaque ligne (`restBits`) et le nombre de lignes de chaque slot
   * (`slotUsed`) ne sont plus téléversés : la partition GPU les écrit dans ces mêmes tampons, dans
   * le même tampon de commandes et avant cette passe. Sans partition ils gardent ce que leur
   * création leur a donné — aucune ligne dans la moitié testée, tous les slots compactés.
   */
  encode(
    encoder: GPUCommandEncoder,
    items: Uint32Array,
    count: number,
    itemsFrom: number,
    itemsTo: number,
    maxVertexCount: number,
    selection?: { maskBuffer: GPUBuffer; maskOffset: number },
  ): void;
  /** Les fiches de dessin telles que la carte les tient : ce que la partition GPU lit pour
   *  connaître le bac, la couche et les triangles de chaque ligne. */
  itemsBuffer: GPUBuffer;
  /** Les bits de reste de l'image, un par ligne : ce que la partition GPU écrit avant la passe. */
  restBitsBuffer: GPUBuffer;
  /** Les lignes comptées par slot indirect : ce que la partition GPU écrit avant la passe. */
  slotUsedBuffer: GPUBuffer;
  indirectBuffer: GPUBuffer; // slots × 16 bytes
  instanceBuffer: GPUBuffer; // slotCap u32 page indices, ordered
  slotOffsetsBuffer: GPUBuffer; // the per-slot group offsets locate each slot in instanceBuffer
  /** Slots this compaction was built for: `slotCount(layerSlots)`. */
  slots: number;
  dispose(): void;
};
