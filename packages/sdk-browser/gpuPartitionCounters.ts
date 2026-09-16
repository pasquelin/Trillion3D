import { createGpuPeriodicReadback } from './gpuPeriodicReadback.ts';
import {
  STATE_WORDS,
  ST_HISTORY_OCCLUDERS,
  ST_IN_FRONT,
  ST_MODE,
  ST_OCCLUDERS,
  ST_OVERSIZED,
  ST_OVERSIZED_TRIANGLES,
  ST_REJECTED,
  ST_REJECTED_TRIANGLES,
  ST_TESTED,
  ST_TESTED_TRIANGLES,
  ST_TWO_PASS,
} from './gpuPartitionContract.ts';

/**
 * Ce qu'une image a décidé et compté, et le numéro de cette image.
 *
 * Tous ces nombres sont écrits par la carte : le processeur ne les relève qu'une image sur quinze,
 * par la relecture périodique. Ils décrivent donc une image antérieure à celle qui les rend, comme
 * `gpuPassMs`, et restent `undefined` tant qu'aucun relevé n'est revenu. Rien n'y est déduit.
 */
export type PartitionCountsFrame = {
  frame: number;
  occluders: number;
  tested: number;
  rejected: number;
  oversized: number;
  testedTriangles: number;
  rejectedTriangles: number;
  oversizedTriangles: number;
  historyOccluders: number;
  inFront: number;
  /** 1 quand l'image a partagé par l'historique d'occulteurs, 0 quand elle a partagé par la médiane. */
  fromHistory: number;
  twoPass: number;
};

const empty = (): PartitionCountsFrame => ({
  frame: -1,
  occluders: 0,
  tested: 0,
  rejected: 0,
  oversized: 0,
  testedTriangles: 0,
  rejectedTriangles: 0,
  oversizedTriangles: 0,
  historyOccluders: 0,
  inFront: 0,
  fromHistory: 0,
  twoPass: 0,
});

/** Le relevé périodique des compteurs de partition : une copie, un mappage, aucune attente. */
export function createPartitionCounters(device: GPUDevice) {
  const counted = empty();
  let sampledFrame = -1;
  const reader = createGpuPeriodicReadback((mapped) => {
    const words = new Uint32Array(mapped);
    counted.frame = sampledFrame;
    counted.occluders = words[ST_OCCLUDERS];
    counted.tested = words[ST_TESTED];
    counted.rejected = words[ST_REJECTED];
    counted.oversized = words[ST_OVERSIZED];
    counted.testedTriangles = words[ST_TESTED_TRIANGLES];
    counted.rejectedTriangles = words[ST_REJECTED_TRIANGLES];
    counted.oversizedTriangles = words[ST_OVERSIZED_TRIANGLES];
    counted.historyOccluders = words[ST_HISTORY_OCCLUDERS];
    counted.inFront = words[ST_IN_FRONT];
    counted.fromHistory = words[ST_MODE];
    counted.twoPass = words[ST_TWO_PASS];
  });

  /** Le tampon de relevé, fait à la première image relevée et jamais une fois par image. */
  const ensure = () => {
    if (reader.buffer) return true;
    if (typeof device.createBuffer !== 'function') return false;
    try {
      const buffer = device.createBuffer({
        label: 'WG partition counts readback',
        size: STATE_WORDS * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      if (typeof buffer.mapAsync !== 'function' || typeof buffer.getMappedRange !== 'function') {
        buffer.destroy();
        return false;
      }
      reader.adopt(buffer);
      return true;
    } catch {
      return false;
    }
  };

  return {
    due: (frame: number) => reader.due(frame) && ensure(),
    encodeCopy(encoder: GPUCommandEncoder, state: GPUBuffer, frame: number) {
      if (!reader.buffer) return;
      sampledFrame = frame;
      reader.copy(encoder, state, 0, STATE_WORDS * 4);
      reader.sampled(frame);
    },
    submitted: reader.submitted,
    counts: () => (reader.ready ? counted : undefined),
    dispose: reader.dispose,
  };
}
