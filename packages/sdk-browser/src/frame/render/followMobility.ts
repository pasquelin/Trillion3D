import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The roots the layout resizes over, read synchronously by `worldOfRoot`: one closure for all. */
let roots: WebgpuPagesRuntime['layout']['selectionRoots']
const worldOfRoot = (rank: number) => roots[rank].world.elements

/**
 * The placements' mobility state sized for the placements the session holds, once an image before
 * the cut: which placement has moved, the pose it was last seen at — what a placement's move reads
 * (`mobility.move`, `../../lighting/shadows/casters/mobility.ts`) and the static layer of the
 * shadow maps follows. No word is kept for a cluster: none is a persistent record any more
 * (`../../geometry/dag/visible/layout.ts`).
 */
export function followPlacementMobility(rt: WebgpuPagesRuntime) {
  const { lights, layout } = rt,
    { selectionRoots } = layout
  if (!lights.pageLayout) return
  roots = selectionRoots
  lights.mobility.ensure(selectionRoots.length, worldOfRoot)
}
