import { DRAW_INDIRECT_STRIDE } from '../draw/draw.ts';
import { createGpuPeriodicReadback } from '../core/periodicReadback.ts';
import { SHADOW_COUNT_SAMPLE_BYTES } from './batchBudget.ts';
import { DRAW_INDIRECT_WORDS } from '../draw/contract.ts';

/** What the last sampled frame's region culls kept, and that frame's number. */
export interface ShadowCullCounts {
  frame: number;
  regions: number;
  kept: number;
}

/** Clusters the `commands` first commands draw: the device's own count, never estimated. */
export function sumKeptClusters(words: Uint32Array, commands: number) {
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
 * pages. A region holds `commands` of them — the cull's two lists (#965) —, all summed.
 */
export function createGpuShadowCullCounts(device: GPUDevice, commands = 1) {
  const sampleBytes = commands * SHADOW_COUNT_SAMPLE_BYTES,
    regionBytes = commands * DRAW_INDIRECT_STRIDE;
  const counted: ShadowCullCounts = { frame: -1, regions: 0, kept: 0 };
  let sampledRegions = 0,
    sampledFrame = -1;
  // The three fields move together, when the sample returns: a count is never named by a
  // frame it does not describe.
  const reader = createGpuPeriodicReadback((mapped) => {
    counted.frame = sampledFrame;
    counted.regions = sampledRegions;
    counted.kept = sumKeptClusters(new Uint32Array(mapped), sampledRegions * commands);
  });
  reader.adopt(
    device.createBuffer({
      label: 'Trillion3D shadow cull counts readback',
      size: sampleBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  );
  return {
    /** Encodes the copy of a batch's `regions` commands, when the frame is sampled. */
    sample(encoder: GPUCommandEncoder, indirect: GPUBuffer, regions: number, frame: number) {
      if (!regions) return;
      if (!reader.open(frame)) {
        if (!reader.due(frame)) return;
        sampledRegions = 0;
        sampledFrame = frame;
        reader.sampled(frame);
      }
      const size = regions * regionBytes;
      if (sampledRegions * regionBytes + size > sampleBytes) return;
      reader.copy(encoder, indirect, 0, size);
      sampledRegions += regions;
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
