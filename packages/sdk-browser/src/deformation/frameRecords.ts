/**
 * THE STORE OF A SESSION'S DEFORMATION RECORDS (`frame.ts`): the arrays and the block they lie in
 * (`deformationRecords`), and the joining of placements behind the ones held (`appendRecords`).
 */
import { resized } from '../../../math/src/sequence/resized.ts'
import { createWaveHeld, type WaveHeld } from './waveFrame.ts'
import { createSkinPalettes } from './skinPalettes.ts'
import type { Deformed } from './frame.ts'
import { recordLayout, RECORD_WORD } from './layout.ts'

/** The records of a session's placements and what writes them: each record's first float plus
 *  one and its layout, the block and its words, each placement's reach, whether it moves and
 *  whether its record is to upload, its staleness read this frame, the mesh each was written for, its waves' stretch, the skin
 *  palettes, whether no frame was written yet, and the uploaded revision. The per-placement arrays
 *  hold places for the placements and the block the floats the records span, both grown by the
 *  engine's one rule (`resized`) when placements join (`appendRecords`). */
export type Records = ReturnType<typeof deformationRecords>

/** An owner no mesh is: a record not written yet is written for another mesh than the one it meets. */
const UNWRITTEN = {}

export function deformationRecords() {
  const block = new Float32Array(1)
  return {
    placed: [] as (Deformed | null)[],
    /** Placements with a record. */
    deforming: 0,
    /** Floats the records span, the block holding at least as many. */
    floats: 0,
    block,
    words: new Uint32Array(block.buffer),
    bases: new Uint32Array(0),
    layouts: [] as (ReturnType<typeof recordLayout> | null)[],
    reach: new Float64Array(0),
    moving: new Uint8Array(0),
    dirty: new Uint8Array(0),
    // Each placement's `stale` answer once read this frame: 0 not yet, 1 fresh, 2 stale; noted
    // for frame `knownFor` alone, -1 for none.
    known: new Uint8Array(0),
    knownFor: -1,
    waveHeld: [] as (WaveHeld | null)[],
    owners: [] as (object | null | undefined)[],
    skins: createSkinPalettes([], block),
    first: true,
    revision: 0,
  }
}

/**
 * Placements `entries` join the records behind the ones held, by the rule the open laid them out
 * with: a record's shape is fixed when it is made, its head written once, its floats end to end
 * after the others'. The arrays and the block grow by `resized` when they are full. Returns the
 * first new placement's rank.
 */
export function appendRecords(r: Records, entries: readonly (Deformed | null)[]) {
  const first = r.placed.length,
    count = first + entries.length
  r.bases = resized(r.bases, count)
  r.reach = resized(r.reach, count)
  r.moving = resized(r.moving, count)
  r.dirty = resized(r.dirty, count)
  r.known = resized(r.known, count)
  // A record's shape is fixed with the session: its layout is measured once.
  const added = entries.map((entry, k) => {
    if (!entry) return null
    const layout = recordLayout(entry.shape)
    r.bases[first + k] = r.floats + 1
    // Records lie end to end: the stage reads the block float by float (`deformWgsl.ts`).
    r.floats += layout.floats
    r.deforming++
    return layout
  })
  const block = resized(r.block, r.floats)
  if (block !== r.block) {
    r.block = block
    r.words = new Uint32Array(block.buffer)
    r.skins.use(block)
  }
  // A record's counts are fixed with the session too: its head is written once.
  entries.forEach((entry, k) => {
    if (!entry) return
    const at = r.bases[first + k] - 1
    const { joints, targets, waves, soft = 0 } = entry.shape
    r.words.set([joints, targets, waves, soft], at + RECORD_WORD.joints)
  })
  entries.forEach((entry, k) => {
    r.placed.push(entry)
    r.layouts.push(added[k])
    r.waveHeld.push(entry?.shape.waves ? createWaveHeld() : null)
    r.owners.push(UNWRITTEN)
  })
  r.skins.append(entries)
  return first
}
