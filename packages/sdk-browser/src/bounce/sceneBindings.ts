import { computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import type { ProxyResources } from '../gpu/dag/cutReaders.ts'

/** The bindings of the proxy in a program that casts its rays, in one group: its own buffer
 *  (`runtimeLayout.ts`), and the culling's record tables, read where they lie — the placements'
 *  records, every placement's world and every instance (`gpu/dag/worldTable.ts`), and its placement
 *  tree, which the rays walk (`gpu/dag/treeTable.ts`). */
export type SceneBindings = {
  group: number
  proxy: number
  worlds: number
  tree: number
}

/** What names a fragment of a program over `scene`: its bindings. */
export const sceneKey = ({ group, proxy, worlds, tree }: SceneBindings) =>
  `${group}, ${proxy}, ${worlds}, ${tree}`

/** The layout entries of the proxy's three bindings in `scene`: its buffer, read-only, and the
 *  culling's worlds and tree, read by `textureLoad`. */
export const sceneLayoutEntries = ({ proxy, worlds, tree }: SceneBindings) => [
  computeBufferEntry(proxy, 'read-only-storage'),
  computeTextureEntry(worlds, 'uint', '2d-array'),
  computeTextureEntry(tree, 'uint', '2d-array'),
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
