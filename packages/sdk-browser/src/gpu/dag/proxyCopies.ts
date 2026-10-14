/**
 * THE BLENDED COPIES THE PROXY TRACES (`proxyInstances.ts`): the copies the forward family draws,
 * members of the proxy after the placements — no member of the culling's tree —, each an instance
 * past the placements' and a world of the arena's (`proxyArena.ts`), their poses the host's
 * (`BlendCopy.matrix`), read again at each cut.
 */
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { sameMatrixFloat32 } from '../../../../math/src/matrix/matrixElements.ts'
import { rowParked } from '../../placement/rows.ts'
import type { ProxyCopy } from './proxyInstances.ts'
import { INSTANCE, INSTANCE_WORDS, RUNTIME_WORLD_WORDS } from '../../bounce/runtimeLayout.ts'
import { tintOf, type ProxyState } from './proxyState.ts'

/** The copies of the proxy `state` holds: `set` takes the host's list, `sync` writes what moved. */
export function createProxyCopies(state: ProxyState) {
  const { slots, held, arena, columns, posed, writeInstances, noteError } = state
  /** Instance word `at` set to `word`: whether it moved. */
  function setWord(at: number, word: number) {
    if (held.words[at] === word) return false
    held.words[at] = word
    return true
  }

  /** The copies' instances and poses, as the host holds them now: written where one moved, was
   *  shown or hidden, or wears another cut. */
  function syncCopies() {
    let moved = false
    held.copies.forEach((copy, k) => {
      const at = (slots + k) * INSTANCE_WORDS,
        proxy = copy.proxy
      const cut = proxy?.primitive.runtimeProxy
      const placed = cut && columns.place(cut)
      const shown = !!placed && !copy.hidden && !rowParked(copy.placement)
      // A copy of a deforming mesh stands at its own posed copy, as a placement does.
      const posedAs =
        shown && cut.deform && placed.corner !== undefined
          ? posed.take(slots + k, cut, placed)
          : undefined
      if (!posedAs) posed.drop(slots + k)
      moved =
        setWord(at + INSTANCE.node, shown ? (posedAs?.node ?? placed.node) : NO_INDEX) || moved
      moved =
        setWord(at + INSTANCE.triangle, shown ? (posedAs?.triangle ?? placed.triangle) : 0) || moved
      moved =
        setWord(at + INSTANCE.surface, shown ? arena.surfaceSlot(proxy.surface, tintOf(cut)) : 0) ||
        moved
      moved = setWord(at + INSTANCE.mark, 0) || moved
      if (!shown) return
      const world = copy.matrix.elements
      if (!sameMatrixFloat32(held.copyWorlds, world, k * RUNTIME_WORLD_WORDS)) {
        copyMatrix4(held.copyWorlds, world, k * RUNTIME_WORLD_WORDS)
        moved = true
      }
      noteError(cut.cellMetres, world, 0)
    })
    if (!moved || !held.copies.length || !(arena.buffer || columns.placing)) return
    const made = arena.made()
    writeInstances(slots, held.copies.length)
    arena.send(made, arena.byteAt(arena.layout.copyWorlds), held.copyWorlds)
  }

  /** The copies the instance words and worlds are laid out for. */
  const copiesHeld = () => held.copyWorlds.length / RUNTIME_WORLD_WORDS

  /** The blended copies the forward family draws, members of this proxy after the placements:
   *  their poses are the host's (`BlendCopy.matrix`), read again at each cut. The host's list grows
   *  in place as a source joins: every cut counts it again (`refresh`) before it writes the
   *  copies. */
  function setCopies(next: readonly ProxyCopy[]) {
    if (next === held.copies && next.length === copiesHeld()) return
    if (next.length !== copiesHeld()) {
      const kept = held.words.subarray(0, slots * INSTANCE_WORDS)
      held.copies = next
      posed.dropPast(slots + next.length)
      held.words = new Uint32Array((slots + next.length) * INSTANCE_WORDS).fill(NO_INDEX)
      held.words.set(kept)
      held.copyWorlds = new Float32Array(next.length * RUNTIME_WORLD_WORDS)
      arena.relayout({ copies: next.length })
    } else held.copies = next
    syncCopies()
  }

  return { set: setCopies, sync: syncCopies, held: copiesHeld }
}
