import { CULLING_RECORD_FLOATS } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'
import { cullingOfParts } from './cullingBuilder.ts'

/** One cluster as the hierarchy builder takes it, a group part of its own: its box, its own ball
 *  and error, and for a cluster something replaces, its level and the band of that replacement; a
 *  root, which nothing replaces, has none, its own ball its LOD ball. */
export type CullingInput = {
  min: ArrayLike<number>
  max: ArrayLike<number>
  level?: number
  sphere?: ArrayLike<number> | null
  lodError?: number | null
  parentSphere?: ArrayLike<number> | null
  parentError?: number | null
}

/**
 * THE CULLING HIERARCHY of `clusters` (`cullingOfParts`), each cluster a part of its own at its
 * rank — no group and no streaming page joins two here —, its LOD ball the band of what replaces
 * it, its own ball for a root. Run where the cut runs (`../runtime/runtimeCut.ts`), the page
 * worker's.
 */
export const buildCullingHierarchy = (module: SdkWasm, clusters: readonly CullingInput[]) =>
  cullingOfParts(module, clusters.length, (view) =>
    clusters.forEach((cluster, k) => {
      const at = k * CULLING_RECORD_FLOATS,
        root = cluster.parentError === null || cluster.parentError === undefined,
        ball = (root ? cluster.sphere : cluster.parentSphere) ?? cluster.sphere
      view.set(cluster.min as ArrayLike<number>, at)
      view.set(cluster.max as ArrayLike<number>, at + 3)
      for (let a = 0; a < 4; a++) view[at + 6 + a] = ball ? ball[a] : 0
      view[at + 10] = cluster.lodError ?? 0
      view[at + 11] = root ? Infinity : (cluster.parentError as number)
      view[at + 12] = cluster.level ?? 0
      view[at + 13] = k
      view[at + 14] = 1
    }),
  )
