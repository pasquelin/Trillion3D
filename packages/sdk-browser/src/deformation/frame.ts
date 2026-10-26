import { paletteStretch, PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts'
import type { Skeleton } from '../../../sdk-core/src/world/animation/skeleton.ts'
import type { BankTrack } from '../../../sdk-core/src/scene/core/animationBanks.ts'
import type { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'
import { heldInverse, wavesChanged, writeWaves } from './waveFrame.ts'
import { writeSoftSource, type SoftSource } from './softSource.ts'
import { appendRecords, deformationRecords, type Records } from './frameRecords.ts'
import type { MatrixElements } from '../session/host/matrixElements.ts'
import {
  KIND_MORPH,
  KIND_SKIN,
  KIND_WAVE,
  KIND_SOFT,
  keepPrevious,
  RECORD_WORD,
  type RecordShape,
} from './layout.ts'

/** What a deformed placement is moved by: its mesh's skeleton, morph weights and waves, or the
 *  track of the scene's animation banks it plays. */
export type DeformedMesh = {
  readonly sourceIdentity?: object | null
  skeleton?: Skeleton
  morphTargetInfluences?: number[]
  waves?: WaterSurface | null
  softSource?: SoftSource
  /** The world its skeleton's bones are read in, when it is not the one its placement stands in:
   *  the mesh's own within the model's graph (`PlacementRows.local`). */
  readonly frame?: ArrayLike<number>
  /** The track it plays now (`bankTrack`): its row's (`PlacementRows.tracks`), or a banked node's
   *  mesh's own (`Mesh.bank`). The GPU poses it from that track's record (`bankTracks.ts`): no
   *  palette of its skeleton is written for it. */
  readonly bank?: BankTrack
}

/** One deformed placement: where it stands, its mesh, the counts its record holds and how far
 *  each source can move a vertex from its rest pose (`primitives[].deformation`). */
export type Deformed = {
  world: MatrixElements
  mesh: DeformedMesh
  shape: RecordShape
  reach: { joints: ArrayLike<number>; targets: ArrayLike<number> }
  /** The record of a track of the animation banks (`bankTracks.ts`), no placement's: it skins in
   *  both frames, and the GPU writes its two palettes every image (`bankWgsl.ts`). */
  readonly track?: true
}

/** Whether placement `i`'s morph weights or waves moved since its record was written: what a
 *  mixer or a clock changes without moving a node, which no scene revision announces. */
function stale(
  { layouts, bases, owners, words, block, waveHeld }: Records,
  i: number,
  entry: Deformed,
) {
  const layout = layouts[i]!,
    at = bases[i] - 1,
    soft = entry.mesh.softSource
  if (owners[i] !== entry.mesh.sourceIdentity) return true
  if (soft && soft.version !== words[at + RECORD_WORD.softVersion]) return true
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
  writeSoftSource(block, from, soft, cold || words[at + RECORD_WORD.softVersion] === 0)
  words[at + RECORD_WORD.softVersion] = soft.version
  return soft.reach
}

/** The head of track record `i` (`Deformed.track`), written when it joins (`cold`): it skins in
 *  both frames, its palettes the GPU's. Nothing of it moves the block, and its reach is no
 *  placement's: its head goes up with the block once, the frame it joins (`updateRecords`). */
function holdTrack({ words, moving, dirty }: Records, i: number, at: number, cold: boolean) {
  if (cold) words[at + RECORD_WORD.kinds] = words[at + RECORD_WORD.previousKinds] = KIND_SKIN
  moving[i] = dirty[i] = 0
  return 0
}

/** Writes placement `i`'s record for this frame; returns how far it moves a vertex. */
function writeRecord(r: Records, i: number, entry: Deformed) {
  const { block, words, owners } = r
  const cold = r.first || owners[i] !== entry.mesh.sourceIdentity
  owners[i] = entry.mesh.sourceIdentity
  const at = r.bases[i] - 1
  if (entry.track) return holdTrack(r, i, at, cold)
  const { shape, mesh } = entry,
    layout = r.layouts[i]!,
    joints = shape.joints * PALETTE_FLOATS,
    palette = at + layout.palette,
    weights = at + layout.weights
  r.skins.keep(i, palette, joints)
  keepPrevious(block, weights, shape.targets)
  words[at + RECORD_WORD.previousKinds] = words[at]
  let kinds = 0,
    most = 0,
    moved = !cold && staleOnce(r, i, entry)
  // A mesh that plays a bank's track takes no palette of its skeleton: its rows name the track's
  // record while it plays (`bankTracks.ts`).
  if (shape.joints && mesh.skeleton && !mesh.bank) {
    moved = r.skins.write(i, entry, palette, joints, cold, moved)
    most = r.skins.reachOf(i)
    kinds |= KIND_SKIN
  }
  if (shape.targets && mesh.morphTargetInfluences) {
    const morphed = writeMorphs(r, entry, weights, cold)
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
  words[at] = kinds
  if (cold) words[at + RECORD_WORD.previousKinds] = kinds
  r.moving[i] = moved || kinds !== words[at + RECORD_WORD.previousKinds] ? 1 : 0
  r.dirty[i] = cold || r.moving[i] ? 1 : 0
  return most
}

/**
 * This frame's records, the last frame's kept beside them (`DeformationFrame.update`). Returns
 * whether records need uploading, including the first pose and the previous pose settling after
 * movement stops. `frame` takes the answers `pending` noted for it.
 */
function updateRecords(r: Records, frame: number | undefined) {
  if (frame === undefined || r.knownFor !== frame) r.known.fill(0)
  let changed = r.first
  for (let i = 0; i < r.placed.length; i++) {
    const entry = r.placed[i]
    if (!entry) continue
    // Last frame's flag: a record that moved then uploads once more, its previous pose settling.
    changed ||= r.moving[i] === 1 || r.owners[i] !== entry.mesh.sourceIdentity
    r.reach[i] = writeRecord(r, i, entry)
    // This frame's flag, which `writeRecord` just set.
    changed ||= r.moving[i] === 1
  }
  r.known.fill(0)
  r.knownFor = -1
  r.first = false
  if (changed) r.revision++
  return changed
}

/** For placement `i` whose record holds waves alone — no joint, target or soft source —, the
 *  waves that carry it this frame, or `null` while it is drawn at rest; `undefined` for any
 *  other placement (`wavePages.ts`). */
function wavesAloneOf(r: Records, i: number) {
  const entry = r.placed[i],
    shape = entry?.shape
  if (!shape?.waves || shape.joints || shape.targets || shape.soft) return undefined
  return r.words[r.bases[i] - 1] & KIND_WAVE ? (entry!.mesh.waves?.waveModel ?? null) : null
}

/** Whether the next frame's records differ from this one's, or this one moved from the last:
 *  a frame that cannot be held, nor count as quiet. The answers are noted for `frame`'s
 *  `update` (`staleOnce`); without one, none is. */
function pendingRecords(r: Records, frame?: number) {
  r.known.fill(0)
  r.knownFor = frame ?? -1
  for (let i = 0; i < r.placed.length; i++) {
    const entry = r.placed[i]
    if (entry && (r.moving[i] === 1 || staleOnce(r, i, entry))) return true
  }
  return false
}

/** Drops the answers `pending` noted: an input they read moved since — the host walked the
 *  scene and rewrote the worlds a record compares (`uploadWorlds`) —, so `update` reads it again. */
function forgetKnown(r: Records) {
  r.known.fill(0)
  r.knownFor = -1
}

/**
 * The deformation records of a session's placements, one block (`layout.ts`): `bases[i]` is
 * placement `i`'s record's first float plus one, zero when it does not deform. Each frame
 * (`update`) keeps the last frame's values beside this one's — the temporal pass reprojects each
 * vertex from where it was — and measures how far each placement can move a vertex (`reach`, in
 * the placement's units), which the cuts grow its bounds by. Every record deforms, whatever its
 * placement's size on screen. A palette is written only when an input it reads changed
 * (`skinPalettes.ts`); a track's record (`Deformed.track`) has its palettes written by the GPU,
 * never here. Nothing is allocated after it is made.
 */
export function createDeformationFrame(placed: readonly (Deformed | null)[] = []) {
  const r = deformationRecords()
  appendRecords(r, placed)
  return {
    /** Placements `entries` join the records, behind the others': their floats follow the
     *  others', the block grown by `resized` when it is full. Returns the first one's rank. */
    append: (entries: readonly (Deformed | null)[]) => appendRecords(r, entries),
    /** Placement `i`'s world is now `world`: its row is another buffer's, the same row. */
    rebind(i: number, world: MatrixElements) {
      const entry = r.placed[i]
      if (entry) entry.world = world
    },
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
    wavesAlone: (i: number) => wavesAloneOf(r, i),
    /** How many waves placement `i`'s record draws: its count when the session opened. */
    drawnWaves: (i: number) => r.placed[i]?.shape.waves ?? 0,
    /** Wave placement `i`'s world `elements` inverted, as its record holds it (`heldInverse`). */
    waveInverse: (i: number, elements: ArrayLike<number>) => heldInverse(r.waveHeld[i]!, elements),
    pending: (frame?: number) => pendingRecords(r, frame),
    forget: () => forgetKnown(r),
    update: (frame?: number) => updateRecords(r, frame),
  }
}

/** A session's records (`createDeformationFrame`). */
export type DeformationFrame = ReturnType<typeof createDeformationFrame>
