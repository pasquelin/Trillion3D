import { transformAffinePoint } from '../../../../math/src/vector/vector.ts'
import type { SceneProxy } from '../../contracts/proxy.ts'
import type { createProxyLeaves } from './proxyLeaves.ts'
import { sameElements } from '../../../../math/src/matrix/matrixElements.ts'

/** Poses the owned leaves whose groups' owners agree, once motion has stopped. `data` holds the
 *  session's triangles, `canonical` the ones they are written from, `groupOf` each triangle's group. */
export function createProxySettling(
  data: Pick<SceneProxy['data'], 'groupOffsets' | 'owners' | 'triangles'>,
  canonical: Float32Array,
  groupOf: Uint32Array,
  leaves: ReturnType<typeof createProxyLeaves>,
  deltas: Float32Array[],
) {
  const { groupOffsets, owners } = data
  /** Every owner of the group under one pose: the only case one triangle still describes. */
  const coincident = (group: number) => {
    const first = deltas[owners[groupOffsets[group] * 2]]
    for (let owner = groupOffsets[group] + 1; owner < groupOffsets[group + 1]; owner++)
      if (!sameElements(deltas[owners[owner * 2]], first)) return false
    return true
  }
  /** A triangle at its owners' pose. The pose's f32 evaluation, rounded once, stays inside the
   *  padded boxes the last refit gave it: the tree already covers the settled pose. */
  const write = (t: number) => {
    const m = deltas[owners[groupOffsets[groupOf[t]] * 2]]
    for (let v = t * 9; v < t * 9 + 9; v += 3)
      transformAffinePoint(data.triangles, m, canonical[v], canonical[v + 1], canonical[v + 2], v)
  }
  /** Poses every owned leaf whose groups all agree; the others stay owned until motion. */
  return () => {
    let settled = false
    for (let leaf = 0; leaf < leaves.count; leaf++) {
      if (!leaves.owned[leaf]) continue
      let agree = true
      for (let t = leaves.firsts[leaf]; agree && t < leaves.ends[leaf]; t++)
        agree = coincident(groupOf[t])
      if (!agree) continue
      leaves.pose(leaf, write)
      settled = true
    }
    return settled
  }
}
