import type { PartitionFrame } from './gpuPartitionUniform.ts';
import type { PartitionCountsFrame } from './gpuPartitionCounters.ts';

/** Les tampons que la partition écrit mais ne possède pas : ceux de la compaction de dessin, et le
 *  tampon de verdicts du test Hi-Z, qu'elle relit pour alimenter l'historique d'occulteurs. */
export type PartitionSources = {
  items: GPUBuffer;
  flags: GPUBuffer;
  restBits: GPUBuffer;
  slotUsed: GPUBuffer;
};

/** Ce que la dernière image a envoyé au noyau, recopié : l'entrée exacte de sa projection. */
export type KeptFrame = {
  rows: number;
  width: number;
  height: number;
  near: number;
  view: Float64Array;
  viewProj: Float64Array;
};

export type GpuPartition = {
  /** L'entrée de la dernière image encodée, ou `undefined` avant la première. */
  readonly lastFrame: KeptFrame | undefined;
  /** Relit les mots que le noyau a écrits pour `rows` lignes ; `undefined` si l'appareil ne mappe
   *  pas. Ce n'est pas une passe de l'image : elle alloue, copie, puis rend son tampon. */
  readRowData(rows: number): Promise<Uint32Array | undefined>;
  /** Les coins monde par ligne, écrits par l'appelant sur la plage sale de la table. */
  corners: GPUBuffer;
  /** Les bornes de la moitié testée, déjà empaquetées pour le noyau d'occultation. */
  tested: GPUBuffer;
  /** Les compteurs de l'image et sa décision de partage ; le noyau d'occultation y lit son compte. */
  state: GPUBuffer;
  /** Le rectangle d'écran et la borne de profondeur de chaque ligne, tels que le noyau les a écrits. */
  rowData: GPUBuffer;
  /** L'entrée de l'image, telle que `encode` l'a écrite : matrices ancrées, plan proche, taille de
   *  cible et table des mips. Le test d'occultation des transparents lit ce MÊME tampon, pour que
   *  les deux projections de l'image partagent l'arithmétique et non seulement la règle. */
  uniforms: GPUBuffer;
  uploadCorners(packed: Float32Array, from: number, to: number): void;
  encode(encoder: GPUCommandEncoder, frame: PartitionFrame): void;
  /** Vrai quand l'intervalle du relevé périodique est écoulé et qu'aucun n'est en route. */
  countsDue(frame: number): boolean;
  /** Encode la copie des compteurs que cette image vient d'écrire. */
  encodeCounts(encoder: GPUCommandEncoder, frame: number): void;
  /** Demande le mappage de la copie encodée, une fois l'image soumise. */
  countsSubmitted(): void;
  /** Ce que la dernière image relevée a décidé et compté, ou `undefined` avant le premier relevé. */
  counts(): PartitionCountsFrame | undefined;
  dispose(): void;
};
