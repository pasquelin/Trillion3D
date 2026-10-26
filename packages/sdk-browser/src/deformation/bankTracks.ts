/**
 * THE TRACKS OF A SESSION'S ANIMATION BANKS (`../../../sdk-core/src/scene/core/animationBanks.ts`):
 * what the deformation holds for the instanced skinned objects its roots draw, owned by the
 * session's deformation (`session.ts`).
 *
 * - One TRACK RECORD per item of every banks a root of the session names — its rows'
 *   (`PlacementRows.banks`), its draw node's or its rows' source meshes' (`Mesh.bank`) —, in the
 *   deformation block behind the records held (`frame.ts`, `Deformed.track`): as many joints as its
 *   bake, skinning in both frames, its two palettes — this frame's, at the second its clock draws,
 *   then the last one's, at the second it drew — written by the GPU's bank pass every image
 *   (`bankWgsl.ts`), never by the CPU. Made at the open and at a growth (`join`), as roots name
 *   banks no record holds yet.
 * - The table that pass reads (`BANK_TRACK`), one row a track, written each frame from the clocks
 *   (`write`), and every banks' floats end to end (`pool`), sent once a banks joins.
 * - The BANKED ROOTS, those that can play a track (`createRootTracks`), and what each reads this
 *   frame (`play`): while its row — or its node — plays a track and it animates by the screen size
 *   rule, the track's record and the result blocks every root playing it shares (`shared`, made by
 *   `assignDeformationOutputs`, `DeformationOutput.shared`); while it plays one under its screen
 *   size, its rest pages, drawn at its world — its skin's frame, the space the bake's palette is
 *   in: it is skinned in no view where it does not animate; while it plays none, its own record and
 *   results, those of its rows' moving sources, or nothing.
 *
 * The screen size rule is `bankScreen.ts`'s, the tracks a root can play `rootTracks.ts`'s.
 */
import {
  bankTrack,
  type AnimationBanks,
  type BankTrack,
} from '../../../sdk-core/src/scene/core/animationBanks.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { ClusterRoot, DeformationOutput, PageRec } from '../geometry/selection/types.ts'
import { IDENTITY_WORLD } from '../session/host/matrixElements.ts'
import { animates, boundsReach } from './bankScreen.ts'
import type { Deformed, DeformedMesh, DeformationFrame } from './frame.ts'
import { RECORD_HEAD } from './layout.ts'

/** Words of a track's row in the table the bank pass reads (`bankWgsl.ts`), in this order: its
 *  record's palette — its first float in the deformation block, which the pass's record places in
 *  the float pool —, its bake's joints and frames, where the bake's inverse binds and keys start
 *  among the banks' floats (`pool`), and its rate in frames a second (a float): the words its join
 *  writes; then the second it draws this frame and the one it drew the frame before (two floats,
 *  `write`), then whether the pass poses it this frame (`play`: a root reads its palettes). */
const BANK_TRACK = {
  palette: 0,
  joints: 1,
  frames: 2,
  inverse: 3,
  keys: 4,
  time: 5,
  previous: 6,
  rate: 7,
  used: 8,
  words: 9,
} as const

/** The result blocks the roots playing one track share, by the roots' page list then by track:
 *  one block a page with a geometry page, none for a track no such page of the list has. */
export type SharedOutputs = WeakMap<
  readonly PageRec[],
  Map<BankTrack, (DeformationOutput | undefined)[] | undefined>
>

/** What a banked root reads (`BankedRoot.reads`) when it is no track's rank: its own record and
 *  results, or nothing. */
const OWN = -2,
  REST = -1

/** A root that can play a bank's track, and what it reads this frame. */
type BankedRoot = {
  /** Its rank in the cut. */
  readonly rank: number
  readonly root: ClusterRoot<PageRec>
  /** What it plays by (`placementDeformation`): its track now is `mesh.bank`. */
  readonly mesh: DeformedMesh
  /** Its own record's rank in the frame — none there for a root with no record —, its own
   *  results, and which of `OWN` and `REST` it reads while it plays no track. */
  readonly entry: number
  readonly own: (DeformationOutput | undefined)[] | undefined
  readonly idle: number
  /** The track's rank it reads, `OWN` or `REST`. */
  reads: number
  /** This frame: whether `reads` changed, how far its pages reach past their rest boxes, and
   *  whether what it draws moved — what it reads moved, or it reads another. */
  flipped: boolean
  reach: number
  moved: boolean
}

/** No joint reach and no target: a track's record moves no placement of its own. */
const NO_REACH = { joints: [], targets: [] }

/** The record of item `item` of `banks` (`Deformed.track`): its bake's joints, skinning alone. */
const trackRecord = (banks: AnimationBanks, item: number): Deformed => ({
  world: IDENTITY_WORLD,
  mesh: { bank: bankTrack(banks, item) },
  shape: { joints: banks.bakes[banks.items[item].bake].joints, targets: 0, waves: 0 },
  reach: NO_REACH,
  track: true,
})

/** What the tracks hold: each one's banks, item and record's rank in the frame; the banks joined,
 *  where each one's floats start among all of them, and each item's track; the table the bank
 *  pass reads. */
type TrackTable = {
  tracks: { banks: AnimationBanks; item: number; entry: number }[]
  joined: AnimationBanks[]
  starts: number[]
  firsts: Map<AnimationBanks, number[]>
  floats: number
  revision: number
  interpolate: boolean
  table: Uint32Array<ArrayBuffer>
  tableFloats: Float32Array<ArrayBuffer>
}

/** The rank of `track` among the tracks, -1 for one of banks no record holds. */
const rankOf = (t: TrackTable, track: BankTrack) => t.firsts.get(track.banks)?.[track.item] ?? -1

/** `banks` gets a record for each of its items, behind the records held, and the static words
 *  of their rows; a banks held already gets none. */
function joinBanks(t: TrackTable, frame: DeformationFrame, banks: AnimationBanks) {
  const { tracks, firsts } = t
  if (firsts.has(banks)) return
  const ranks: number[] = []
  firsts.set(banks, ranks)
  const first = frame.append(banks.items.map((_, item) => trackRecord(banks, item)))
  const grown = new Uint32Array((tracks.length + banks.items.length) * BANK_TRACK.words)
  grown.set(t.table)
  const table = (t.table = grown)
  const tableFloats = (t.tableFloats = new Float32Array(table.buffer))
  for (let item = 0; item < banks.items.length; item++) {
    const { joints, frames, inverseAt, keysAt, rate } = banks.bakes[banks.items[item].bake],
      row = tracks.length * BANK_TRACK.words
    // A record keeps its place in the block: the block alone moves in the pool.
    table[row + BANK_TRACK.palette] = frame.bases[first + item] - 1 + RECORD_HEAD
    table[row + BANK_TRACK.joints] = joints
    table[row + BANK_TRACK.frames] = frames
    table[row + BANK_TRACK.inverse] = t.floats + inverseAt
    table[row + BANK_TRACK.keys] = t.floats + keysAt
    tableFloats[row + BANK_TRACK.rate] = rate
    ranks[item] = tracks.length
    tracks.push({ banks, item, entry: first + item })
  }
  t.joined.push(banks)
  t.starts.push(t.floats)
  t.floats += banks.pool.length
  t.revision++
}

/** The table's words of this frame: no track used yet (`playRoot` marks those a root reads), the seconds each track's clock draws now and drew before;
 *  every clock advances by the world's seconds times `timeScale` from its next step on
 *  (`animationBankTimeScale`), and a track blends its keys when `blend` says so
 *  (`animationBankInterpolation`). */
function writeTrackTable(t: TrackTable, timeScale: number, blend: boolean) {
  const { tracks, joined, tableFloats } = t
  t.interpolate = blend
  for (let k = 0; k < joined.length; k++) joined[k].clock.timeScale = timeScale
  for (let i = 0, row = 0; i < tracks.length; i++, row += BANK_TRACK.words) {
    const { banks, item } = tracks[i]
    t.table[row + BANK_TRACK.used] = 0
    tableFloats[row + BANK_TRACK.time] = banks.clock.time[item]
    tableFloats[row + BANK_TRACK.previous] = banks.clock.previous[item]
  }
}

/** What one banked root reads this frame, seen by `cam` (`createBankTracks`.`play`). */
function playRoot(
  banked: BankedRoot,
  t: TrackTable,
  frame: DeformationFrame,
  shared: SharedOutputs,
  cam: EngineCamera,
  multiple: number,
  minScreenSize: number,
) {
  const { root } = banked,
    track = banked.mesh.bank,
    at = track ? rankOf(t, track) : -1
  let reads = banked.idle,
    outputs = reads === OWN ? banked.own : undefined
  if (track && at >= 0) {
    outputs = shared.get(root.pages)?.get(track)
    reads = REST
    if (outputs && animates(root, track, multiple * multiple, cam.eye, minScreenSize)) reads = at
  }
  if (reads >= 0) {
    t.table[reads * BANK_TRACK.words + BANK_TRACK.used] = 1
    const { banks, item } = t.tracks[reads]
    banked.reach = boundsReach(banks.items[item].bounds, root.localBox)
    banked.moved = banks.clock.time[item] !== banks.clock.previous[item]
  } else if (reads === OWN) {
    banked.reach = frame.reach[banked.entry]
    banked.moved = frame.dirty[banked.entry] === 1
  } else {
    banked.reach = 0
    banked.moved = false
    outputs = undefined
  }
  banked.flipped = reads !== banked.reads
  if (!banked.flipped) return
  // What it draws is another pose: its shadows are drawn again.
  banked.moved = true
  banked.reads = reads
  root.deformationOutputs = outputs
}

/** The banked roots, in the order they joined, and by rank: how one is added, whether it plays
 *  a track and the record its rows name. */
function createBankedRoots(frame: DeformationFrame, t: TrackTable) {
  const roots: BankedRoot[] = [],
    byRank: (BankedRoot | undefined)[] = []
  return {
    roots,
    /** Root `rank` can play a track, `mesh` naming the one it plays (`DeformedMesh.bank`), its own
     *  record at `entry` of the frame and its own results those it holds now. */
    add(rank: number, root: ClusterRoot<PageRec>, mesh: DeformedMesh, entry: number) {
      const own = root.deformationOutputs,
        idle = own || frame.bases[entry] ? OWN : REST
      const banked: BankedRoot = {
        rank,
        root,
        mesh,
        entry,
        own,
        idle,
        reads: idle,
        flipped: false,
        reach: 0,
        moved: false,
      }
      roots.push(banked)
      byRank[rank] = banked
    },
    /** Whether root `rank` can play a track. */
    plays: (rank: number) => byRank[rank] !== undefined,
    /** The record the rows of root `rank` name now, -1 for none, while it can play a track;
     *  `undefined` for any other root, whose rows name its own. */
    named(rank: number) {
      const banked = byRank[rank]
      if (!banked) return undefined
      if (banked.reads >= 0) return t.tracks[banked.reads].entry
      return banked.reads === OWN ? banked.entry : -1
    },
  }
}

/** The tracks of a session whose records are `frame`'s (the header). */
export function createBankTracks(frame: DeformationFrame) {
  const t: TrackTable = {
    ...{ tracks: [], joined: [], starts: [], firsts: new Map() },
    ...{ floats: 0, revision: 0, interpolate: true },
    ...{ table: new Uint32Array(0), tableFloats: new Float32Array(0) },
  }
  const shared: SharedOutputs = new WeakMap()
  const { roots, add, plays, named } = createBankedRoots(frame, t)
  return {
    /** The result blocks the roots playing each track share (`assignDeformationOutputs`). */
    shared,
    /** The banked roots, in the order they joined. */
    roots: roots as readonly BankedRoot[],
    /** The tracks held: the rows of the table. */
    get count() {
      return t.tracks.length
    },
    /** Moves each time a banks joins: the floats to send again (`pool`). */
    get revision() {
      return t.revision
    },
    /** The table the bank pass reads, `BANK_TRACK.words` words a track. */
    get table() {
      return t.table
    },
    /** Whether a track blends its two nearest keys this frame (`animationBankInterpolation`). */
    get interpolate() {
      return t.interpolate
    },
    join: (banks: AnimationBanks) => joinBanks(t, frame, banks),
    ...{ add, plays, named },
    /** Every banks' floats end to end, each from where its tracks' rows say: what the bank pass
     *  reads, made again when one joins (`revision`). */
    pool() {
      const all = new Float32Array(t.floats)
      t.joined.forEach((banks, k) => all.set(banks.pool, t.starts[k]))
      return all
    },
    write: (timeScale: number, blend: boolean) => writeTrackTable(t, timeScale, blend),
    /**
     * What each banked root reads this frame, seen by `cam` under the run-time setting
     * `minScreenSize` (the header's rule): its `reads`, its `reach` and whether that moved; a root
     * whose `reads` changed (`flipped`) reads its results anew (`ClusterRoot.deformationOutputs`),
     * its rows to be pointed at them (`rowWord`). Nothing is allocated.
     */
    play(cam: EngineCamera, minScreenSize: number) {
      const p = cam.projection,
        multiple = Math.max(p[0], p[5])
      for (let k = 0; k < roots.length; k++)
        playRoot(roots[k], t, frame, shared, cam, multiple, minScreenSize)
    },
  }
}
