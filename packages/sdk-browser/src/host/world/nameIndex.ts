import { objectEdits } from '../../../../sdk-core/src/scene/core/nodeEdits.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/** Name → the first node of a prepared source, in prefix order, that bears it, and the edit count
 *  it was built under (`objectEdits`): the walk's answer while no name or parent changed. A
 *  plain `traverse`, not `getObjectByName`, which a loaded model answers from its own file graph. */
const nameIndexes = new WeakMap<Object3D, { edits: number; names: Map<string, Object3D> }>()

/** The named node of the prepared scene, or `undefined`, by the index, rebuilt by one walk when
 *  anything was renamed, added, removed or freed since. */
export function findNode(source: Object3D, nodeName: string) {
  const edits = objectEdits()
  let index = nameIndexes.get(source)
  if (index?.edits !== edits) {
    const names = new Map<string, Object3D>()
    source.traverse((node) => void (names.has(node.name) || names.set(node.name, node)))
    nameIndexes.set(source, (index = { edits, names }))
  }
  return index.names.get(nodeName)
}
