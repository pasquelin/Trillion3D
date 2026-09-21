// The two laps of a "transparents in a few orders" bench scene, and what they count.
//
// Each scene has its own: a lap shared between two scenes is a polymorphic call site, and
// the timer pays for it. Likewise, each loop is in the function where the engine holds it —
// a loop written inline in the lap slows the others, at strictly identical work.
import { orderBlendPasses } from '../../webgpuBlendOrder.ts';
import { expandBlendPlan, itemKept } from '../../webgpuBlendExpandCpu.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from '../../webgpuBlendRuns.ts';
import { pose, spans, type BenchItem, type BenchSide, type Frame } from './scenesTransparents.ts';
import {
  argumentsReference,
  classementReference,
  encodeReference,
} from '../oracles/transparents-ordres.ts';

/** What the encode loop counted on the last lap: read by the sample, not by the lap. */
let comptes = 0;
export const appelsEncodes = () => comptes;

/**
 * THE ENCODE LOOP, counted: a slice that names its item and that the frustum rejects is not
 * encoded; a slice that merges several always is (`webgpuBlendDraw.ts`).
 *
 * It is in ITS function, as in the engine, where it lives in the draw pass and not in
 * ranking. Written inline in the lap, it slowed the sort the lap calls and that the
 * loop does not touch: from +7.6% to −7.6% on the double-sided camera jump, at strictly
 * identical work. A bench that measures something other than the shipped form measures nothing.
 */
function compteAppels(blendState: BenchSide['blendState']) {
  const runs = blendState.runs[0],
    order = blendState.orders[0],
    keep = blendState.keepPacked,
    count = blendState.runCount[0];
  let encodes = 0;
  for (let run = 0; run < count; run++) {
    const at = run * RUN_WORDS,
      owner = runOwner(order[runs[at]], runs[at + 1]);
    if (owner === RUN_SHARED || itemKept(keep, owner)) encodes++;
  }
  return encodes;
}

/** The CPU-fallback expansion, reread as index ranges: what the rasterizer would see. */
function etale(
  blendState: BenchSide['blendState'],
  miroir: { expanded: Uint32Array; args: Uint32Array },
  output: Uint32Array,
) {
  // Reduced fixture, matching the pattern already used by `webgpuBlendPlan.test.ts`.
  const items = blendState.blendGpu as unknown as BenchItem[];
  const instances = expandBlendPlan({
    order: blendState.orders[0],
    runs: blendState.runs[0],
    runCount: blendState.runCount[0],
    draws: blendState.drawsPacked,
    keep: blendState.keepPacked,
    itemCounts: blendState.cpuItemCounts,
    instances: blendState.cpuInstances,
    maxVertexWords: blendState.maxVertexWords,
    vertexShift: blendState.vertexShift,
    instanceBase: 0,
    argsBase: 0,
    expanded: miroir.expanded,
    args: miroir.args,
  });
  let at = 0;
  for (let i = 0; i < instances; i++) {
    const item = miroir.expanded[i * 2],
      cle = miroir.expanded[i * 2 + 1];
    output[at++] = item;
    output[at++] = items[item].paged ? spans[cle * 2] : cle;
    output[at++] = items[item].paged ? spans[cle * 2 + 1] : items[item].count - cle;
  }
  return at;
}

/** The four laps of a scene, and the CPU-fallback mirrors allocated outside the lap. */
export function tours(before: BenchSide, after: BenchSide) {
  const blendState = after.blendState;
  const miroir = {
    expanded: new Uint32Array(blendState.instanceCapacity * 2),
    args: new Uint32Array(blendState.maxPlanEntries * 8),
  };
  /** The previous path: ranking, arguments of every item, one call per entry. */
  const reference = (images: Frame[], sequence: boolean) => {
    const output = [];
    for (const image of images) {
      pose(before, image);
      classementReference(before.scene, before.order, image.eye);
      argumentsReference(before.scene, before.args);
      const rendu = encodeReference(before.scene, before.order, before.args, before.output);
      output.push(sequence ? before.output.subarray(0, rendu.length) : rendu.rejected);
    }
    return output;
  };
  /** The batch path: ranking, frustum and slices, then one call per slice. */
  const optimisee = (images: Frame[], sequence: boolean) => {
    const output = [];
    for (const image of images) {
      pose(after, image);
      const rejets = orderBlendPasses(blendState, image.eye);
      if (sequence) {
        output.push(after.output.subarray(0, etale(blendState, miroir, after.output)));
        continue;
      }
      comptes = compteAppels(blendState);
      output.push(rejets);
    }
    return output;
  };
  return {
    tourAvant: (images: Frame[]) => reference(images, false),
    tourApres: (images: Frame[]) => optimisee(images, false),
    tourAvantSeq: (images: Frame[]) => reference(images, true),
    tourApresSeq: (images: Frame[]) => optimisee(images, true),
  };
}
