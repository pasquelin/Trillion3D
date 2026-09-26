/**
 * The backends of the cut rule's tests that hold residency on the host (`./held.ts`): the CPU cut
 * and the WebGL2 image's cut, over placements of the synthetic DAG. Each names to its pool's feed
 * the pages whose residency flipped, as the WebGPU rank journal and the WebGL2 page store do, and
 * counts the residency answers its cuts asked for.
 */
import { selectVisiblePages } from './cut.ts';
import { createHeldResidency, type HeldResidency } from './held.ts';
import { createImageCut } from '../../backend/autonomous/imageCut.ts';
import { placements, stripCamera } from './cutRuleBackends.fixture.ts';
import type { RuleDag } from './cutRule.fixture.ts';
import type { ClusterRoot, PageRec } from '../selection/types.ts';

/** Pages by packed index, as `placements` lays them out. */
const ids = (list: readonly PageRec[]) => list.map((page) => page.packedIndex!);

/** A backend over `roots`' pool: each frame `load`s the pages whose residency flipped, names each
 *  to the feed, then cuts with `cutOf`; `reads` counts the residency answers its cuts asked for. */
function hostBackend(
  roots: ClusterRoot<PageRec>[],
  held: HeldResidency,
  load: (page: PageRec, resident: boolean) => void,
  cutOf: () => { shown: readonly PageRec[]; wanted: readonly PageRec[] },
  reads: () => number,
) {
  const pages = roots.flatMap((root) => root.pages),
    now = new Uint8Array(pages.length);
  held.track(roots);
  const frame = (resident: Uint8Array) => {
    pages.forEach((page, at) => {
      if (now[at] === resident[at]) return;
      now[at] = resident[at];
      load(page, resident[at] === 1);
      held.moved(page);
    });
    const { shown, wanted } = cutOf();
    return { drawn: ids(shown), wanted: ids(wanted) };
  };
  return Object.assign(frame, { held, reads });
}

/** The CPU cut (`./cut.ts`) with the host answering for residency, as the WebGPU CPU path and the
 *  light cuts ask it: the rule on `./held.ts`'s readiness, its descent pruned on the open counts. */
export function cpuBackend(dag: RuleDag, threshold: number, roots = placements(dag, 1)) {
  const cam = stripCamera(dag),
    on: boolean[] = [];
  let reads = 0;
  const isResident = (page: PageRec) => (reads++, on[page.packedIndex!] === true);
  const options = {
    pixelError: threshold,
    viewport: [1280, 720] as [number, number],
    held: createHeldResidency({ isResident }),
  };
  const load = (page: PageRec, resident: boolean) => void (on[page.packedIndex!] = resident);
  const cut = () => selectVisiblePages(roots, cam, options);
  return hostBackend(roots, options.held, load, cut, () => reads);
}

/** The WebGL2 image's cut (`../../backend/autonomous/imageCut.ts`) over `roots`, under a pool
 *  that admits every request; `held` is what its page store moves. */
export const webgl2Cut = (roots: ClusterRoot<PageRec>[], held = createHeldResidency()) =>
  createImageCut({
    roots,
    viewport: [1280, 720],
    shown: [],
    desired: [],
    requested: [],
    revision: () => 0,
    pool: { admit: (asked) => asked.length, fit: (asked) => asked.length, held: {} },
    held,
  });

/** The WebGL2 image's cut of the DAG, each page resident when it holds its index array, as the
 *  WebGL2 page store loads and releases them. */
export function webgl2Backend(dag: RuleDag, threshold: number, roots = placements(dag, 1)) {
  const cam = stripCamera(dag),
    held = createHeldResidency(),
    cut = webgl2Cut(roots, held);
  let reads = 0;
  for (const root of roots)
    for (const page of root.pages) {
      let array: Uint32Array | undefined;
      Object.defineProperty(page, 'array', {
        get: () => (reads++, array),
        set: (value?: Uint32Array) => void (array = value),
      });
    }
  const load = (page: PageRec, resident: boolean) =>
    void (page.array = resident ? new Uint32Array(3) : undefined);
  return hostBackend(
    roots,
    held,
    load,
    () => cut(cam, threshold),
    () => reads,
  );
}
