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

export type GpuPartition = {
  /** Les coins monde par ligne, écrits par l'appelant sur la plage sale de la table. */
  corners: GPUBuffer;
  /** Les bornes de la moitié testée, déjà empaquetées pour le noyau d'occultation. */
  tested: GPUBuffer;
  /** Les compteurs de l'image et sa décision de partage ; le noyau d'occultation y lit son compte. */
  state: GPUBuffer;
  /** Le rectangle d'écran et la borne de profondeur de chaque ligne, tels que le noyau les a écrits. */
  rowData: GPUBuffer;
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
