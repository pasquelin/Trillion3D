import { DRAW_INDIRECT_STRIDE } from '../draw/draw.ts';
import { createGpuPeriodicReadback } from '../core/periodicReadback.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';

/** Words of one indirect draw command; the instance count is its second word. */
const COMMAND_WORDS = DRAW_INDIRECT_STRIDE / 4;

/** What the last sampled frame's region culls kept, and that frame's number. */
export interface ShadowCullCounts {
  frame: number;
  regions: number;
  kept: number;
}

/** Clusters the `regions` first commands draw: the device's own count, never estimated. */
export function sumKeptClusters(words: Uint32Array, regions: number) {
  let kept = 0;
  for (let region = 0; region < regions; region++) kept += words[region * COMMAND_WORDS + 1];
  return kept;
}

/**
 * Periodic sample of what the shadow region culls kept: the indirect commands the cull wrote,
 * copied one frame in fifteen and mapped after submission, never waited for. A diagnostic
 * count for the profile, outside the measured pass: the other fourteen frames copy nothing.
 */
export function createGpuShadowCullCounts(device: GPUDevice) {
  const counted: ShadowCullCounts = { frame: -1, regions: 0, kept: 0 };
  let sampledRegions = 0,
    sampledFrame = -1;
  // The three fields move together, when the sample returns: a count is never named by a
  // frame it does not describe.
  const reader = createGpuPeriodicReadback((mapped) => {
    counted.frame = sampledFrame;
    counted.regions = sampledRegions;
    counted.kept = sumKeptClusters(new Uint32Array(mapped), sampledRegions);
  });
  reader.adopt(
    device.createBuffer({
      label: 'Trillion3D shadow cull counts readback',
      size: MAX_SHADOW_REGIONS * DRAW_INDIRECT_STRIDE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  );
  return {
    /** Encodes the copy of this frame's `regions` commands, when a sample is due. */
    sample(encoder: GPUCommandEncoder, indirect: GPUBuffer, regions: number, frame: number) {
      if (!regions || !reader.due(frame)) return;
      reader.copy(encoder, indirect, 0, regions * DRAW_INDIRECT_STRIDE);
      sampledRegions = regions;
      sampledFrame = frame;
      reader.sampled(frame);
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
