import {
  gpuPassBlockOf,
  gpuPassBlockTotals,
} from '../../packages/sdk-browser/src/gpu/core/passBlocks.ts';
import type { GpuPassTimings } from '../../packages/sdk-core/src/index.ts';
import { distribution } from './rapport.ts';
import type { PassesGpu } from './rapportPasses.ts';

/**
 * GPU passes and their blocks, summarised over the readings of a series.
 *
 * A pass missing from a reading does not count as zero there: its distribution only carries
 * readings where it has a duration. A block, for its part, only holds on readings where all its
 * passes are measured — that is the `gpuPassBlockTotals` rule, and a distribution of partial sums
 * would betray it. `null` with no reading, never an empty array that would read as "measured,
 * nothing to say".
 */
export function passesGpu(samples: GpuPassTimings[] | null | undefined): PassesGpu | null {
  if (!samples || !samples.length) return null;
  const parPasse = new Map<string, number[]>();
  const blocs: Record<'visibilityMs' | 'materialsMs' | 'otherMs', number[]> = {
    visibilityMs: [],
    materialsMs: [],
    otherMs: [],
  };
  for (const sample of samples) {
    if (sample.truncated) continue;
    for (const pass of sample.passes) {
      if (typeof pass.gpuMs !== 'number') continue;
      if (!parPasse.has(pass.name)) parPasse.set(pass.name, []);
      parPasse.get(pass.name)?.push(pass.gpuMs);
    }
    const totals = gpuPassBlockTotals(sample);
    for (const bloc of Object.keys(blocs) as (keyof typeof blocs)[])
      if (typeof totals[bloc] === 'number') blocs[bloc].push(totals[bloc]);
  }
  return {
    releves: samples.length,
    blocs: Object.fromEntries(Object.entries(blocs).map(([k, v]) => [k, distribution(v)])),
    passes: [...parPasse]
      .map(([name, values]) => ({ name, bloc: gpuPassBlockOf(name), gpuMs: distribution(values) }))
      .sort((a, b) => (b.gpuMs?.p50 ?? -1) - (a.gpuMs?.p50 ?? -1)),
  };
}
