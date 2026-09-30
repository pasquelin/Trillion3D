import { FLAG_MORPH, FLAG_SKIN, FLAG_SOFT_SOURCE } from '../cluster/format.ts';
import { rootOf } from '../page/selection/placements.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PageRec } from '../page/selection/selection.ts';
import { pageAddress } from '../webgpu/row/pageSlots.ts';

/** Current position, previous position and current normal: eleven words per vertex, including owner and frame tags. */
export const DEFORM_VERTEX_WORDS = 11;

/** The word a row or a transparent span carries to name a page's results (`deformationOutput`),
 *  the page's slot starting at word `offset`: their first word plus one, zero for none. */
export const deformOutputWord = (output: PageRec['deformationOutput'], offset: number) =>
  output ? offset + output.from + 1 : 0;

/**
 * Reserve deformation results in the geometry cache's own slots. All placements sharing a
 * compressed page have disjoint tails; eviction, relocation, root coverage and the one geometry
 * budget therefore account for the results along with their source. No output spans slots.
 */
export function deformationSlotBytes(
  pages: readonly PageRec[],
  sourceBytes: number,
  roots: readonly ClusterRoot<PageRec>[] = [],
) {
  const ends = new Map<string, number>();
  let bytes = sourceBytes;
  for (const page of pages) {
    delete page.deformationOutput;
    const mesh = page.sourceMesh;
    if (
      !mesh?.skeleton &&
      !mesh?.morphTargetInfluences?.length &&
      !mesh?.waves &&
      mesh?.geometry?.usage !== 'dynamic' &&
      !((page.geometryPage?.flags ?? 0) & (FLAG_SOFT_SOURCE | FLAG_SKIN | FLAG_MORPH)) &&
      ![
        ...((roots.length ? rootOf(roots, page).placement : undefined)?.rows.sourceModels ?? []),
      ].some((source) => source.waves)
    )
      continue;
    const count = page.geometryPage?.vertexCount ?? page.attributes.position?.count ?? 0;
    if (!count) continue;
    const address = pageAddress(page);
    const from = ends.get(address) ?? sourceBytes / 4;
    page.deformationOutput = { from: from + 2, count };
    const end = from + count * DEFORM_VERTEX_WORDS;
    ends.set(address, end);
    bytes = Math.max(bytes, end * 4);
  }
  return bytes;
}
