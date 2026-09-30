import { DRAW_INDIRECT_STRIDE } from '../draw/draw.ts';
import { createGpuPeriodicReadback } from '../core/periodicReadback.ts';
import {
  MAX_SHADOW_BATCHES,
  SHADOW_COUNT_SAMPLE_BYTES,
  SHADOW_TESTED_SAMPLE_BYTES,
} from './batchBudget.ts';
import { DRAW_INDIRECT_WORDS } from '../draw/contract.ts';

/** What the last sampled frame's region culls kept, and that frame's number: of the clusters
 *  kept, `moving` those of regions that draw moving casters alone (#991); `tested`, the casters
 *  they tested, kept or not (#1211) — zero for a sampler that reads no tested word. */
export interface ShadowCullCounts {
  frame: number;
  regions: number;
  kept: number;
  moving: number;
  tested: number;
}

/** Clusters the `commands` first commands draw: the device's own count, never estimated. */
function sumKeptClusters(words: Uint32Array, commands: number) {
  let kept = 0;
  for (let command = 0; command < commands; command++)
    kept += words[command * DRAW_INDIRECT_WORDS + 1];
  return kept;
}

/**
 * Periodic sample of what the shadow region culls kept: the indirect commands the cull wrote,
 * copied one frame in fifteen and mapped after submission, never waited for. A diagnostic
 * count for the profile, outside the measured pass: the other fourteen frames copy nothing.
 *
 * The sampled frame copies every batch's commands after the last (`SHADOW_COUNT_SAMPLE_BYTES` a
 * command a region, sized for the most batches a frame draws), so the count covers all the frame's
 * pages. A region holds `commands` of them — the cull's two lists (#965) —, all summed; the regions
 * `moving` names at the copy are summed apart too. With `testedWord`, each batch's commands are
 * followed by that word of its buffer: the casters its culls tested (`SHADOW_TESTED_WORD`).
 */
export function createGpuShadowCullCounts(device: GPUDevice, commands = 1, testedWord = -1) {
  const tested = testedWord >= 0,
    regionBytes = commands * DRAW_INDIRECT_STRIDE,
    sampleBytes = commands * SHADOW_COUNT_SAMPLE_BYTES + (tested ? SHADOW_TESTED_SAMPLE_BYTES : 0);
  const counted: ShadowCullCounts = { frame: -1, regions: 0, kept: 0, moving: 0, tested: 0 },
    /** Whether each sampled region draws moving casters alone, and each sampled batch's regions. */
    movingRegion = new Uint8Array(SHADOW_COUNT_SAMPLE_BYTES / DRAW_INDIRECT_STRIDE),
    batchRegions = new Uint32Array(MAX_SHADOW_BATCHES);
  let sampledRegions = 0,
    sampledBatches = 0,
    sampledBytes = 0,
    sampledFrame = -1;
  // The fields move together, when the sample returns: a count is never named by a frame it
  // does not describe.
  const reader = createGpuPeriodicReadback((mapped) => {
    counted.frame = sampledFrame;
    counted.regions = sampledRegions;
    const words = new Uint32Array(mapped),
      stride = commands * DRAW_INDIRECT_WORDS;
    counted.kept = counted.moving = counted.tested = 0;
    for (let batch = 0, at = 0, region = 0; batch < sampledBatches; batch++) {
      for (let k = 0; k < batchRegions[batch]; k++, region++, at += stride) {
        const kept = sumKeptClusters(words.subarray(at), commands);
        counted.kept += kept;
        if (movingRegion[region]) counted.moving += kept;
      }
      if (tested) counted.tested += words[at++];
    }
  });
  reader.adopt(
    device.createBuffer({
      label: 'Trillion3D shadow cull counts readback',
      size: sampleBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  );
  return {
    /** Encodes the copy of a batch's `regions` commands, when the frame is sampled; `moving`
     *  says which regions draw moving casters alone. */
    sample(
      encoder: GPUCommandEncoder,
      indirect: GPUBuffer,
      regions: number,
      frame: number,
      moving?: (region: number) => boolean,
    ) {
      if (!regions) return;
      if (!reader.open(frame)) {
        if (!reader.due(frame)) return;
        sampledRegions = sampledBatches = sampledBytes = 0;
        sampledFrame = frame;
        reader.sampled(frame);
      }
      const size = regions * regionBytes + (tested ? 4 : 0);
      if (sampledBytes + size > sampleBytes || sampledBatches >= MAX_SHADOW_BATCHES) return;
      reader.copy(encoder, indirect, 0, regions * regionBytes);
      if (tested) reader.copy(encoder, indirect, testedWord * 4, 4);
      for (let region = 0; region < regions; region++)
        movingRegion[sampledRegions + region] = moving?.(region) ? 1 : 0;
      sampledRegions += regions;
      sampledBytes += size;
      batchRegions[sampledBatches++] = regions;
    },
    /** Requests mapping of the sample, once the frame that copied it is submitted. */
    submitted: reader.submitted,
    /** Counts of the last sampled frame, or nothing until one has come back. */
    counts(): ShadowCullCounts | undefined {
      return reader.ready ? counted : undefined;
    },
    dispose: reader.dispose,
  };
}
