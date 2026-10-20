import { COMPUTE, computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import type { ProxyResources } from '../../geometry/dag/cut/cutReaders.ts'

/** The bindings of the proxy in a program that casts its rays, in one group: its own buffer
 *  (`runtime/runtimeLayout.ts`), and the culling's record tables, read where they lie — the placements'
 *  records, every placement's world and every instance (`geometry/dag/worlds/worldTable.ts`), and its placement
 *  tree, which the rays walk (`geometry/dag/tree/treeTable.ts`). */
export type SceneBindings = {
  group: number
  proxy: number
  worlds: number
  tree: number
}

/** What names a fragment of a program over `scene`: its bindings. */
export const sceneKey = ({ group, proxy, worlds, tree }: SceneBindings) =>
  `${group}, ${proxy}, ${worlds}, ${tree}`

/** The layout entries of the proxy's three bindings in `scene`, seen by `visibility` (the compute
 *  stage by default): its buffer, read-only, and the culling's worlds and tree, read by `textureLoad`. */
export const sceneLayoutEntries = (
  { proxy, worlds, tree }: SceneBindings,
  visibility: number = COMPUTE,
) => [
  computeBufferEntry(proxy, 'read-only-storage', visibility),
  computeTextureEntry(worlds, 'uint', '2d-array', visibility),
  computeTextureEntry(tree, 'uint', '2d-array', visibility),
]

/** The bind-group entries of `resources` at the proxy's three bindings in `scene`. */
export const sceneBindEntries = (
  { proxy, worlds, tree }: SceneBindings,
  resources: ProxyResources,
): GPUBindGroupEntry[] => [
  { binding: proxy, resource: { buffer: resources.buffer } },
  { binding: worlds, resource: resources.worlds },
  { binding: tree, resource: resources.tree },
]
