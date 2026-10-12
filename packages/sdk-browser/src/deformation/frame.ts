import { paletteStretch, PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts'
import type { Skeleton } from '../../../sdk-core/src/world/animation/skeleton.ts'
import type { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { createWaveHeld, wavesChanged, writeWaves, type WaveHeld } from './waveFrame.ts'
import { writeSoftSource, type SoftSource } from './softSource.ts'
import { createSkinPalettes, differs } from './skinPalettes.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import {
  KIND_MORPH,
  KIND_SKIN,
  KIND_WAVE,
  KIND_SOFT,
  recordLayout,
  type RecordShape,
} from './layout.ts'

/** What a deformed placement is moved by: its mesh's skeleton, morph weights and waves. */
export type DeformedMesh = {
  readonly sourceIdentity?: object | null
  skeleton?: Skeleton
  morphTargetInfluences?: number[]
  waves?: WaterSurface | null
  softSource?: SoftSource
}

/** One deformed placement: where it stands, its mesh, the counts its record holds and how far
 *  each source can move a vertex from its rest pose (`primitives[].deformation`). */
export type Deformed = {
  world: MatrixElements
  mesh: DeformedMesh
  shape: RecordShape
  reach: { joints: ArrayLike<number>; targets: ArrayLike<number> }
}

/** The records of a session's placements and what writes them: each record's first float plus
 *  one and its layout, the block and its words, each placement's reach, whether it moves and
 *  whether its record is to upload, its staleness read this frame, the mesh each was written for, its waves' stretch, the skin
 *  palettes, whether no frame was written yet, and the uploaded revision. The per-placement arrays
 *  hold places for the placements and the block the floats the records span, both grown by the
 *  engine's one rule (`resized`) when placements join (`appendRecords`). */
type Records = ReturnType<typeof deformationRecords>

/** An owner no mesh is: a record not written yet is written for another mesh than the one it meets. */
const UNWRITTEN = {}

function deformationRecords() {
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
function appendRecords(r: Records, entries: readonly (Deformed | null)[]) {
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
    r.words[at + 2] = entry.shape.joints
    r.words[at + 3] = entry.shape.targets
    r.words[at + 4] = entry.shape.waves
    r.words[at + 5] = entry.shape.soft ?? 0
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

/** Whether placement `i`'s morph weights or waves moved since its record was written: what a
 *  mixer or a clock changes without moving a node, which no scene revision announces. */
function stale(
  { layouts, bases, owners, words, block, waveHeld }: Records,
  i: number,
  entry: Deformed,
) {
  const layout = layouts[i]!,
    at = bases[i] - 1
  if (owners[i] !== entry.mesh.sourceIdentity) return true
  if (entry.mesh.softSource && entry.mesh.softSource.version !== words[at + 6]) return true
  const weights = entry.mesh.morphTargetInfluences
  for (let t = 0; weights && t < entry.shape.targets; t++)
    if (Math.fround(weights[t] ?? 0) !== block[at + layout.weights + t]) return true
  return wavesChanged(block, entry, at + layout.world, at + layout.wave, waveHeld[i]!)
}

/** `stale`, read once a frame: `pending` notes each answer it reads for the frame it names, the
 *  image's `update` of that same frame takes it — nothing it reads moved between them, nor did any
 *  record it compares — and forgets them all at its end. An answer noted for another frame, or for
 *  none (a read outside the frame, the barrier's), is never taken: no call order is assumed. */
function staleOnce(r: Records, i: number, entry: Deformed) {
  const known = r.known[i]
  if (known) return known === 2
  const answer = stale(r, i, entry)
  r.known[i] = answer ? 2 : 1
  return answer
}

/** Writes placement `entry`'s morph weights at `weights` — the last frame's too when `cold` —;
 *  returns how far they move a vertex, before the skin's stretch. */
function writeMorphs({ block }: Records, entry: Deformed, weights: number, cold: boolean) {
  const { shape, mesh } = entry
  let morphed = 0
  for (let t = 0; t < shape.targets; t++) {
    const weight = mesh.morphTargetInfluences![t] ?? 0
    block[weights + t] = weight
    if (cold) block[weights + shape.targets + t] = weight
    morphed += Math.abs(weight) * (entry.reach.targets[t] ?? 0)
  }
  return morphed
}

/** Writes the soft source of the record at `at` from float `from`; returns how far it moves a
 *  vertex. */
function writeSoft(
  { block, words }: Records,
  at: number,
  from: number,
  soft: SoftSource,
  cold: boolean,
) {
  writeSoftSource(block, from, soft, cold || words[at + 6] === 0)
  words[at + 6] = soft.version
  return soft.reach
}

/** Writes placement `i`'s record for this frame; returns how far it moves a vertex. */
function writeRecord(
  r: Records,
  i: number,
  entry: Deformed,
  skipped: (i: number, reach: number) => boolean,
) {
  const { block, words, owners } = r
  const cold = r.first || owners[i] !== entry.mesh.sourceIdentity
  owners[i] = entry.mesh.sourceIdentity
  const at = r.bases[i] - 1,
    { shape, mesh } = entry,
    layout = r.layouts[i]!,
    joints = shape.joints * PALETTE_FLOATS,
    palette = at + layout.palette,
    weights = at + layout.weights
  r.skins.keep(i, palette, joints)
  block.copyWithin(weights + shape.targets, weights, weights + shape.targets)
  words[at + 1] = words[at]
  let kinds = 0,
    most = 0,
    moved = !cold && staleOnce(r, i, entry)
  if (shape.joints && mesh.skeleton) {
    moved = r.skins.write(i, entry, palette, joints, cold, moved)
    most = r.skins.reachOf(i)
    kinds |= KIND_SKIN
  }
  if (shape.targets && mesh.morphTargetInfluences) {
    const morphed = writeMorphs(r, entry, weights, cold)
    moved ||= differs(block, weights, weights + shape.targets, shape.targets)
    most += morphed * (kinds & KIND_SKIN ? paletteStretch(block, palette, shape.joints) : 1)
    kinds |= KIND_MORPH
  }
  if (shape.waves && mesh.waves) {
    most += writeWaves(block, entry, at + layout.world, at + layout.wave, cold, r.waveHeld[i]!)
    kinds |= KIND_WAVE
  }
  if (shape.soft && mesh.softSource) {
    most += writeSoft(r, at, at + layout.simulation, mesh.softSource, cold)
    kinds |= KIND_SOFT
  }
  if (kinds && skipped(i, most)) kinds = most = 0
  words[at] = kinds
  if (cold) words[at + 1] = kinds
  r.moving[i] = moved || words[at] !== words[at + 1] ? 1 : 0
  r.dirty[i] = cold || r.moving[i] ? 1 : 0
  return most
}

/** This frame's records, the last frame's kept beside them (`DeformationFrame.update`). */
function updateRecords(
  r: Records,
  skipped: (i: number, reach: number) => boolean,
  frame: number | undefined,
) {
  if (frame === undefined || r.knownFor !== frame) r.known.fill(0)
  let changed = r.first
  for (let i = 0; i < r.placed.length; i++) {
    const entry = r.placed[i]
    if (!entry) continue
    // Last frame's flag: a record that moved then uploads once more, its previous pose settling.
    changed ||= r.moving[i] === 1 || r.owners[i] !== entry.mesh.sourceIdentity
    r.reach[i] = writeRecord(r, i, entry, skipped)
    // This frame's flag, which `writeRecord` just set.
    changed ||= r.moving[i] === 1
  }
  r.known.fill(0)
  r.knownFor = -1
  r.first = false
  if (changed) r.revision++
  return changed
}

/**
 * The deformation records of a session's placements, one block (`layout.ts`): `bases[i]` is
 * placement `i`'s record's first float plus one, zero when it does not deform. Each frame
 * (`update`) keeps the last frame's values beside this one's — the temporal pass reprojects each
 * vertex from where it was — and measures how far each placement can move a vertex (`reach`, in
 * the placement's units), which the cuts grow its bounds by. A placement whose `skipped` says its
 * reach projects below the error drawn is drawn at rest, its reach zero. A palette is written only
 * when an input it reads changed (`skinPalettes.ts`). Nothing is allocated after it is made.
 */
export function createDeformationFrame(placed: readonly (Deformed | null)[] = []) {
  const r = deformationRecords()
  appendRecords(r, placed)
  return {
    /** Placements `entries` join the records, behind the others': their floats follow the
     *  others', the block grown by `resized` when it is full. Returns the first one's rank. */
    append: (entries: readonly (Deformed | null)[]) => appendRecords(r, entries),
    /** Placements with a record. */
    get deforming() {
      return r.deforming
    },
    /** The floats the records span. */
    get floats() {
      return r.floats
    },
    /** Revision of uploaded source poses, including deformation settling. */
    get revision() {
      return r.revision
    },
    /** The block: at least `floats` long, replaced by a larger one when the records outgrow it. */
    get block() {
      return r.block
    },
    get words() {
      return r.words
    },
    get bases() {
      return r.bases
    },
    get reach() {
      return r.reach
    },
    get moving() {
      return r.moving
    },
    get dirty() {
      return r.dirty
    },
    /** For placement `i` whose record holds waves alone — no joint, target or soft source —, the
     *  waves that carry it this frame, or `null` while it is drawn at rest; `undefined` for any
     *  other placement (`wavePages.ts`). */
    wavesAlone(i: number) {
      const entry = r.placed[i],
        shape = entry?.shape
      if (!shape?.waves || shape.joints || shape.targets || shape.soft) return undefined
      return r.words[r.bases[i] - 1] & KIND_WAVE ? (entry!.mesh.waves?.waveModel ?? null) : null
    },
    /** How many waves placement `i`'s record draws: its count when the session opened. */
    drawnWaves(i: number) {
      return r.placed[i]?.shape.waves ?? 0
    },
    /** Whether the next frame's records differ from this one's, or this one moved from the last:
     *  a frame that cannot be held, nor count as quiet. The answers are noted for `frame`'s
     *  `update` (`staleOnce`); without one, none is. */
    pending(frame?: number) {
      r.known.fill(0)
      r.knownFor = frame ?? -1
      for (let i = 0; i < r.placed.length; i++) {
        const entry = r.placed[i]
        if (entry && (r.moving[i] === 1 || staleOnce(r, i, entry))) return true
      }
      return false
    },
    /** Drops the answers `pending` noted: an input they read moved since — the host walked the
     *  scene and rewrote the worlds a record compares (`uploadWorlds`) —, so `update` reads it again. */
    forget() {
      r.known.fill(0)
      r.knownFor = -1
    },
    /**
     * This frame's records, the last frame's kept beside them. `skipped(i, reach)` says whether
     * placement `i`, moving a vertex by at most `reach` of its units, projects that below the
     * error the image allows: it is then drawn at rest. Returns whether records need uploading,
     * including the first pose and the previous pose settling after movement stops. `frame`
     * takes the answers `pending` noted for it.
     */
    update: (skipped: (i: number, reach: number) => boolean, frame?: number) =>
      updateRecords(r, skipped, frame),
  }
}

/** A session's deformation records, one block (`createDeformationFrame`). */
export type DeformationFrame = ReturnType<typeof createDeformationFrame>
