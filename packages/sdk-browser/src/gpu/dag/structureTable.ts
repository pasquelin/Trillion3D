import type { ClusterStructureIndex } from '../../page/selection/types.ts'
import type { RecordLayout } from '../core/recordLayout.ts'
import type { PackedDag } from './types.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** Words ahead of a structure's arrays: its pages, then its groups. */
export const STRUCTURE_HEAD = 2

/** The structures' words, one a record (`../core/recordTexture.ts`): the rows' closure reads them
 *  (`../../webgpu/row/rowClosureWgsl.ts`). */
export const STRUCTURE_TABLE: RecordLayout = {
  label: 'Trillion3D DAG structures',
  format: 'r32uint',
  fields: { Word: 1 },
  rowShift: 13,
  layerShift: 10,
}

/** Words of structure `s` as the GPU reads it (`serialized`). */
const structureWords = (s: ClusterStructureIndex) =>
  STRUCTURE_HEAD +
  s.owners.length +
  2 * (s.groupCount + 1) +
  s.childOffsets[s.groupCount] +
  s.outputOffsets[s.groupCount]

/**
 * Structure `s` as the GPU reads it, from its base: its pages and its groups, the group owning each
 * page (`NO_INDEX` for none), then each group's member offsets and members, its output offsets and
 * outputs — the compiled structure as is, the pages local to its page array.
 */
function serialized(s: ClusterStructureIndex) {
  const words = new Uint32Array(structureWords(s)),
    groups = s.groupCount + 1
  words[0] = s.owners.length
  words[1] = s.groupCount
  let at = STRUCTURE_HEAD
  for (let p = 0; p < s.owners.length; p++) words[at++] = s.owners[p] < 0 ? NO_INDEX : s.owners[p]
  for (const list of [
    s.childOffsets.subarray(0, groups),
    s.children.subarray(0, s.childOffsets[s.groupCount]),
    s.outputOffsets.subarray(0, groups),
    s.outputs.subarray(0, s.outputOffsets[s.groupCount]),
  ]) {
    words.set(list, at)
    at += list.length
  }
  return words
}

/**
 * The most groups a walk of `s` holds at once on its stack (`../../webgpu/row/rowClosureWgsl.ts`):
 * a walk pops a group and pushes, in their order, the owner of each output that has one — the last
 * pushed walked first, those before it waiting under it. So from group `g`, the `j`-th owner pushed
 * walks with `j − 1` below it: `F(g) = max(1, k, max_j (j − 1 + F(owner_j)))`, `k` the outputs
 * with an owner. A walk the gate stops holds less. The structure's groups replace finer ones only,
 * so the recursion ends at its roots.
 */
function stackOf(s: ClusterStructureIndex) {
  const held = new Int32Array(s.groupCount)
  const walk = (g: number): number => {
    if (held[g]) return held[g]
    let k = 0,
      most = 1
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const owner = s.owners[s.outputs[i]]
      if (owner < 0) continue
      most = Math.max(most, ++k, k - 1 + walk(owner))
    }
    return (held[g] = most)
  }
  let most = 1
  for (let g = 0; g < s.groupCount; g++) most = Math.max(most, walk(g))
  return most
}

/**
 * THE GROUP STRUCTURES OF A PACKING ON THE GPU (#1527): each primitive's compiled structure, once
 * whatever its placements, at a base a placement reads in its frame words (`worlds.ts`,
 * `STRUCTURE_WORD`) — no word per page, nor per placement but that one. Made as the roots are placed
 * (`baseOf`, the frame words written in placement order), appended behind the live ones, and sent by
 * what was placed since (`flush`), as the content keys are (`evict.ts`). `stackBound` is the most a
 * walk of any of them holds on its stack: the closure kernel is compiled for it.
 */
export function createStructureTable() {
  const bases = new Map<ClusterStructureIndex, number>(),
    order: ClusterStructureIndex[] = []
  let words = 0,
    stack = 1
  return {
    /** The base of structure `s`, placed behind the others at its first placement; `NO_INDEX` for a
     *  placement without one. */
    baseOf(s: ClusterStructureIndex | undefined) {
      if (!s) return NO_INDEX
      let base = bases.get(s)
      if (base === undefined) {
        bases.set(s, (base = words))
        order.push(s)
        words += structureWords(s)
        stack = Math.max(stack, stackOf(s))
      }
      return base
    },
    /** The words the structures take. */
    get words() {
      return words
    },
    /** The structures placed. */
    get count() {
      return order.length
    },
    /** The most groups a walk of any structure holds on its stack. */
    get stackBound() {
      return stack
    },
    /** The structures from rank `from` on, each sent through `send(base, words)`. */
    flush(from: number, send: (base: number, data: Uint32Array) => void) {
      for (let i = from; i < order.length; i++) send(bases.get(order[i])!, serialized(order[i]))
    },
  }
}

export type StructureTable = ReturnType<typeof createStructureTable>

/** The structure table of `packed`, made at its first placement's frame words. */
export const structuresOf = (packed: Partial<Pick<PackedDag, 'structures'>>) =>
  (packed.structures ??= createStructureTable())
