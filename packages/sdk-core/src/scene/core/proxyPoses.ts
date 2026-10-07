import type { SceneProxy } from '../../contracts/proxy.ts'
import { IDENTITY_MATRIX4, linearStretchBound } from '../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { proxyAffineDelta } from './proxyDelta.ts'

/** The poses a motion session keeps for the proxy's source nodes: each node's bind world, its
 *  inverse, and the delta from bind to the current world, written into one shared `transforms`
 *  array (rest, the identity, until the first sync); and the groups each node owns. */
export function createProxyPoses(
  proxy: SceneProxy,
  data: Pick<SceneProxy['data'], 'bindWorlds' | 'groupOffsets' | 'owners'>,
) {
  const transforms = new Float32Array(proxy.instances * 16)
  const groupsOf = new Map<number, Set<number>>()
  const binds: Float64Array[] = [],
    inverses: Float64Array[] = [],
    deltas: Float32Array[] = []
  for (let node = 0; node < proxy.instances; node++) {
    const bind = data.bindWorlds.subarray(node * 16, node * 16 + 16)
    binds.push(bind)
    inverses.push(invertMatrix4(new Float64Array(16), bind))
    deltas.push(transforms.subarray(node * 16, node * 16 + 16))
    deltas[node].set(IDENTITY_MATRIX4)
  }
  for (let group = 0; group < proxy.groups; group++)
    for (let owner = data.groupOffsets[group]; owner < data.groupOffsets[group + 1]; owner++) {
      const node = data.owners[owner * 2]
      let groups = groupsOf.get(node)
      if (!groups) groupsOf.set(node, (groups = new Set()))
      groups.add(group)
    }
  return { transforms, groupsOf, binds, inverses, deltas }
}

/** Writes into `delta` the pose change from `bind` to `world`, `bindInverse` being the inverse of
 *  `bind`; the identity when the two agree to single precision. */
export function proxyNodeDelta(
  delta: Float64Array,
  world: ArrayLike<number>,
  bind: Float64Array,
  bindInverse: Float64Array,
) {
  let unchanged = true
  for (let i = 0; i < 16; i++) unchanged &&= Math.fround(world[i]) === Math.fround(bind[i])
  if (unchanged) delta.set(IDENTITY_MATRIX4)
  else {
    // Translation does not need an inverse, including an originally flattened instance.
    let translation = true
    for (let i = 0; i < 12; i++) translation &&= world[i] === bind[i]
    if (translation) {
      delta.set(IDENTITY_MATRIX4)
      for (let a = 0; a < 3; a++) delta[12 + a] = world[12 + a] - bind[12 + a]
    } else proxyAffineDelta(delta, bind, world, bindInverse)
  }
}

/** How much the largest delta stretches a length: the geometric mean of its largest row and column
 *  sums, the greatest over `nodes`, at least 1. */
export function proxyStretch(nodes: Iterable<number>, deltas: Float32Array[]) {
  let stretch = 1
  for (const node of nodes) {
    stretch = Math.max(stretch, linearStretchBound(deltas[node]))
  }
  return stretch
}
