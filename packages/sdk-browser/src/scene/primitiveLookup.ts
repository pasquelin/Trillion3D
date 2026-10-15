import type { Primitive } from '../../../sdk-core/src/contracts/geometry.ts'

/** The one finder of each primitives array, whoever asks it. */
const finders = new WeakMap<readonly Primitive[], ReturnType<typeof createFinder>>()

/**
 * Manifest primitives looked up by their mesh association. A `find` per mesh walked the whole
 * manifest: loading a scene with N primitives paid N². The first primitive of a key wins,
 * like `find`; a NaN key finds nothing, like `===`. ONE finder per primitives array, built once
 * for every caller: a primitive pushed on the array since is indexed at the next find, one
 * `add`ed is found like the others.
 */
export function primitiveFinder(primitives: readonly Primitive[]) {
  let finder = finders.get(primitives)
  if (!finder) finders.set(primitives, (finder = createFinder(primitives)))
  return finder
}

function createFinder(primitives: readonly Primitive[]) {
  const byMesh = new Map<unknown, Map<unknown, Primitive>>()
  /** `item` is found from now on, unless its key has a primitive already. */
  const add = (item: Primitive) => {
    if (Number.isNaN(item.mesh) || Number.isNaN(item.primitive)) return
    let byPrimitive = byMesh.get(item.mesh)
    if (!byPrimitive) byMesh.set(item.mesh, (byPrimitive = new Map()))
    if (!byPrimitive.has(item.primitive)) byPrimitive.set(item.primitive, item)
  }
  /** How many of the array's primitives are indexed. */
  let indexed = 0
  const find = (association: { meshes?: number; primitives?: number } | undefined) => {
    while (indexed < primitives.length) add(primitives[indexed++])
    const mesh = association?.meshes,
      primitive = association?.primitives ?? 0
    if (Number.isNaN(mesh) || Number.isNaN(primitive)) return undefined
    return byMesh.get(mesh)?.get(primitive)
  }
  return Object.assign(find, { add })
}

/** The name a page gives the primitive a mesh draws, `mesh/primitive` as in a cluster id; none
 *  for a NaN key, as the finder finds none. */
export function primitiveName(association: { meshes?: number; primitives?: number } | undefined) {
  const mesh = association?.meshes,
    primitive = association?.primitives ?? 0
  if (mesh === undefined || Number.isNaN(mesh) || Number.isNaN(primitive)) return undefined
  return `${mesh}/${primitive}`
}
