/**
 * THE TRACKS A ROOT CAN PLAY, of the animation banks its rows or its node name
 * (`createRootTracks`), read once per rows and per node: what makes a root a banked one
 * (`bankTracks.ts`) and gives the deformation work (`session.ts`, `outputs.ts`).
 */
import { bankTrack, type BankTrack } from '../../../sdk-core/src/scene/core/animationBanks.ts'
import type { DrawSource } from '../geometry/selection/drawSource.ts'
import type { ClusterRoot, PageRec } from '../geometry/selection/types.ts'
import type { PlacementRows } from '../placement/rows/rows.ts'

/** No track. */
const NONE: readonly BankTrack[] = []

/** The tracks the rows `rows` drawn from `draw` can play, each once (`createRootTracks`). */
function tracksOf(rows: PlacementRows | undefined, draw: DrawSource | undefined) {
  const found = new Set<BankTrack>()
  const banks = rows?.banks
  if (banks)
    banks.items.forEach((item, rank) => {
      if (item.mesh === draw?.mesh) found.add(bankTrack(banks, rank))
    })
  if (draw?.node?.bank) found.add(draw.node.bank)
  for (const model of rows?.sourceModels ?? []) if (model.bank) found.add(model.bank)
  return found.size ? [...found] : NONE
}

/**
 * The tracks a root can play, each once: the items of its rows' banks drawn with its mesh
 * (`BankItem.mesh` against its draw source's `mesh`), the track of the node drawing it and those
 * of its rows' source meshes (`Mesh.bank`); none for a root no bank names. Each rows and each node
 * is answered once for one pass over roots: a hundred thousand roots can read one rows, whose
 * source meshes can number as many (`createRowsAnimate`'s reason).
 */
export function createRootTracks() {
  const known = new Map<object, readonly BankTrack[]>()
  return (root: ClusterRoot<PageRec>) => {
    const draw = root.pages[0]?.drawSource,
      rows = root.placement?.rows,
      key = rows ?? draw?.node
    if (!key) return NONE
    let tracks = known.get(key)
    if (!tracks) known.set(key, (tracks = tracksOf(rows, draw)))
    return tracks
  }
}
