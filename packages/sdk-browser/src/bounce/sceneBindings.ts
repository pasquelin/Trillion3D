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
