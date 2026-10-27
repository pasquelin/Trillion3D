import {
  assignOffsetSwitches,
  offsetSwitchValues,
  type OffsetSwitchValues,
} from '../../../../sdk-core/src/world/object/offsetSwitches.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/** Gives `o` the switches `saved` holds (a saved node's: `OffsetSwitchValues`, only the ones not at their defaults), the
 *  defaults where it holds none. Every switch is checked before the first is written: a saved scene that holds a value the node
 *  refuses changes nothing of `o`.
 *  @throws RangeError naming the first value refused. */
export function wearOffsets(o: Object3D, saved: OffsetSwitchValues & { kind?: string }) {
  const values = offsetSwitchValues(o, saved)
  if (!values) return
  // A light's `mobility` is its own, read apart.
  if (saved.kind === 'light') delete values.mobility
  assignOffsetSwitches(o, values)
}
