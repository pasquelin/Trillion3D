/**
 * The backends of the cut rule's tests that hold residency on the host (`./held.ts`): the CPU cut
 * and the WebGL2 image's cut, over placements of the synthetic DAG. Each names to its pool's feed
 * the pages whose residency flipped, as the WebGPU rank journal and the WebGL2 page store do, and
 * counts the residency answers its cuts asked for.
 */
import { selectVisiblePages, type SelectionResult } from './cut.ts';
import { createHeldResidency, type HeldResidency } from './held.ts';
import { postPackedBases, type PlacementIndex } from '../selection/placements.ts';
import { createImageCut } from '../../backend/autonomous/imageCut.ts';
import { placements, stripCamera } from './cutRuleBackends.fixture.ts';
import type { RuleDag } from './cutRule.fixture.ts';
import type { ClusterRoot, PageRec } from '../selection/types.ts';

/** The packed rank of each record: the DAG fixture's pages are unique per placement. */
function ranksOf(roots: readonly ClusterRoot<PageRec>[], placement: PlacementIndex) {
  const rank = new Map<PageRec, number>();
  for (let r = 0; r < roots.length; r++)
    for (let p = 0; p < roots[r].pages.length; p++)
      rank.set(roots[r].pages[p], placement.baseOfRoot[r] + p);
  return rank;
}

/** A backend over `roots`' pool: each frame `load`s the pages whose residency flipped, names each
 *  to the feed, then cuts with `cutOf`; `reads` counts the residency answers its cuts asked for. */
function hostBackend(
  roots: ClusterRoot<PageRec>[],
  held: HeldResidency,
  placement: PlacementIndex,
  load: (page: PageRec, rank: number, resident: boolean) => void,
  cutOf: () => SelectionResult<PageRec>,
  reads: () => number,
) {
  const rank = ranksOf(roots, placement),
    pages = roots.flatMap((root) => root.pages),
    now = new Uint8Array(pages.length);
  held.track(roots);
  const frame = (resident: Uint8Array) => {
    pages.forEach((page, at) => {
      if (now[at] === resident[at]) return;
      now[at] = resident[at];
      const packed = rank.get(page)!;
      load(page, packed, resident[at] === 1);
      held.moved(packed, page);
    });
    const result = cutOf();
    return {
      drawn: Array.from(result.shownPacked.subarray(0, result.shown.length)),
      wanted: Array.from(result.wantedPacked.subarray(0, result.wanted.length)),
    };
  };
  return Object.assign(frame, { held, reads });
}

/** The CPU cut (`./cut.ts`) with the host answering for residency, as the WebGPU CPU path and the
 *  light cuts ask it: the rule on `./held.ts`'s readiness, its descent pruned on the open counts. */
export function cpuBackend(dag: RuleDag, threshold: number, roots = placements(dag, 1)) {
  const cam = stripCamera(dag),
    on: boolean[] = [];
  const placement = postPackedBases(roots),
    rank = ranksOf(roots, placement);
  let reads = 0;
  const isResident = (page: PageRec) => (reads++, on[rank.get(page)!] === true);
  const options = {
    pixelError: threshold,
    viewport: [1280, 720] as [number, number],
    held: createHeldResidency({ isResident }, placement),
  };
  const load = (_page: PageRec, packed: number, resident: boolean) => void (on[packed] = resident);
  const cut = () => selectVisiblePages(roots, cam, options);
  return hostBackend(roots, options.held, placement, load, cut, () => reads);
}

/** The WebGL2 image's cut (`../../backend/autonomous/imageCut.ts`) over `roots`, under a pool
 *  that admits every request; `held` is what its page store moves. */
export const webgl2Cut = (roots: ClusterRoot<PageRec>[], held = createHeldResidency()) =>
  createImageCut({
    roots,
    view: {
      viewport: [1280, 720],
      shown: [],
      shownPacked: [],
      desired: [],
      desiredPacked: [],
      requested: [],
    },
    revision: () => 0,
    pool: { admit: (asked) => asked.length, fit: (asked) => asked.length, held: {} },
    held,
  });

/** The WebGL2 image's cut of the DAG, each page resident when it holds its index array, as the
 *  WebGL2 page store loads and releases them. */
export function webgl2Backend(dag: RuleDag, threshold: number, roots = placements(dag, 1)) {
  const cam = stripCamera(dag),
    placement = postPackedBases(roots),
    held = createHeldResidency({}, placement),
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
  const load = (page: PageRec, _packed: number, resident: boolean) =>
    void (page.array = resident ? new Uint32Array(3) : undefined);
  return hostBackend(
    roots,
    held,
    placement,
    load,
    () => cut(cam, threshold),
    () => reads,
  );
}
