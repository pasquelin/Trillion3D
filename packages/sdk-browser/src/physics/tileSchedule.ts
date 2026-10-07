import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { createModelBodies } from './modelBodies.ts'
import { partitionBy } from '../../../sdk-core/src/math/select.ts'
import type { SharedShapes } from './sharedShapes.ts'
import { createTileKeeps } from './tileKeeps.ts'
import { createTileReads } from './tileReads.ts'
import type { createResidentTiles } from './tileResident.ts'
import { moversOf, nearness, selectNearest, type Placed, type TileShape } from './tilePlace.ts'

/** Tile bodies one update builds at most, nearest first: each an ADD in the worker's next step, so
 *  an eye arriving among a thousand placements of a resident tile adds them over frames. */
const BUILDS = 64

/** What a schedule reads and acts on, and where it asks a frame and reports a failure. */
type ScheduleParts = {
  bodies: ReturnType<typeof createPhysicsBodies>
  declared: ReturnType<typeof createModelBodies>
  shapes: SharedShapes
  resident: ReturnType<typeof createResidentTiles>
  invalidate: () => void
  failed: (error: EngineError) => void
}

const byNear = (a: TileShape, b: TileShape) => a.near - b.near
const isIn = (p: Placed) => !p.out
const isHeld = (shape: TileShape) => shape.holders > 0

/**
 * What an update does for the tiles: `want` lists the placements wanted and their tiles, each tile
 * by its nearest placement; `admit` lets in those that fit; `start` builds their bodies on their
 * resident tiles and reads the others (`tileReads.ts`), `BUILDS` bodies an update, another frame
 * asked while bodies wait, then lets the tiles no one uses go; a tile restored as its bytes land
 * builds its placements' bodies at once — no frame may come before a query or a step. Only the
 * U tiles wanted are sorted, the P placements (P ≫ U) only partitioned and selected, O(P);
 * nothing is allocated per update, each list written over with its count.
 */
export class TileSchedule {
  private readonly wanted: Placed[] = []
  private wants = 0
  private readonly tiles: TileShape[] = []
  private tileCount = 0
  private readonly movers: number[] = []
  private moving = 0
  private pass = 0
  /** The placements the last `admit` let in: the front of `wanted`; of them, those `ready` for a
   *  body on a restored tile (`tileKeeps.ts`). */
  private in = 0
  private ready = 0
  private readonly parts: ScheduleParts
  private readonly keeps: ReturnType<typeof createTileKeeps>
  private readonly reads: ReturnType<typeof createTileReads>

  constructor(parts: ScheduleParts) {
    this.parts = parts
    this.keeps = createTileKeeps(parts.shapes, parts.resident.evict)
    this.reads = createTileReads(parts.shapes, this.landed, parts.failed)
  }
  /** Lists the placements of `openings` wanted around `eye` within `range` and the moving bodies
   *  (`nearness`), and their tiles nearest first; one unwanted, of a refused tile, or whose node a
   *  declared body holds, is evicted. */
  want(
    openings: ReadonlyMap<unknown, { placed: Placed[] }>,
    eye: ArrayLike<number>,
    range: number,
  ) {
    const bodies = this.parts.bodies
    this.moving = moversOf(bodies.meshes, bodies.nested, bodies.state.velocity, this.movers)
    this.pass++
    this.wants = this.tileCount = 0
    for (const opening of openings.values()) this.collect(opening, eye, range)
    // Sorted alone, the U tiles of this update: the list cut to them.
    this.tiles.length = this.tileCount
    this.tiles.sort(byNear)
  }
  /**
   * Lets in the placements wanted within `free` bytes of the share and `slots` bodies: the bytes
   * counted once each of the tiles the `slots` nearest placements name, nearest tile first — past
   * the first that does not fit, no farther one is, the room kept for it; one past the whole share
   * never fits, and holds no one back —, then the `slots` nearest placements of the tiles counted,
   * their tiles kept (`tileKeeps.ts`). The others are evicted.
   */
  admit(free: number, slots: number) {
    const tiles = this.tiles,
      wanted = this.wanted,
      wants = this.wants,
      pass = this.pass,
      near = Math.min(wants, Math.max(slots, 0))
    if (near < wants) selectNearest(wanted, wants, near)
    for (let i = 0; i < near; i++) wanted[i].shape.slotted = pass
    let bytes = free
    for (let i = 0; i < tiles.length; i++) {
      const shape = tiles[i]
      if (shape.slotted !== pass || shape.bytes > free) continue
      if (shape.bytes > bytes) break
      bytes -= shape.bytes
      shape.counted = pass
    }
    const counted = partitionBy(wanted, wants, this.counted),
      n = Math.min(counted, near)
    if (n < counted) selectNearest(wanted, counted, n)
    for (let i = n; i < wants; i++) this.parts.resident.evict(wanted[i])
    this.ready = this.keeps.keep(wanted, n, pass)
    this.in = n
  }
  /** Builds the bodies the placements let in wait for on their resident tiles (`build`), and
   *  reads the nearest tiles still to read; then lets go of the tiles no one uses. */
  start() {
    this.build(this.keeps.ready, this.ready)
    this.reads(this.tiles, this.pass)
    this.parts.shapes.settle()
  }
  /** Evicts the farthest tile body the last update let in, for a body that needs its slot. */
  evictFarthest() {
    this.keeps.evictFarthest(this.wanted, this.in)
  }
  /** Lets the farthest restored tiles the last update kept go, every body of them, until `bytes`
   *  more fit the share: the next `admit` finds the room they left taken. */
  letGoFarthest(bytes: number) {
    this.parts.shapes.settle()
    const needed = bytes - this.parts.bodies.ledger.room('collisionBytes')
    this.keeps.letGoFarthest(this.tiles, this.wanted, this.in, this.pass, needed)
  }
  /** Cuts the lists to the placements and tiles still held, once a model left: none names it. */
  trim() {
    let admitted = 0
    for (let i = 0; i < this.in; i++) if (!this.wanted[i].out) admitted++
    // In order: those let in stay first.
    this.wanted.length = this.wants = partitionBy(this.wanted, this.wants, isIn)
    this.tiles.length = this.tileCount = partitionBy(this.tiles, this.tileCount, isHeld)
    this.in = admitted
    this.ready = 0
    this.keeps.trim()
  }
  /** The placements and tiles its lists name, tails included. */
  get listed() {
    return this.wanted.length + this.tiles.length + this.keeps.listed()
  }
  /** Lists the placements of `opening` wanted around `eye` within `range`, and their tiles, each
   *  with its nearest; evicts the others, and takes those out for good out of `opening`. */
  private collect(opening: { placed: Placed[] }, eye: ArrayLike<number>, range: number) {
    const placed = opening.placed,
      parts = this.parts
    let kept = 0
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i],
        shape = p.shape
      if (shape.refused) parts.resident.remove(p)
      // Out for good — its tile or its body refused —: out of its opening.
      if (p.out) continue
      placed[kept++] = p
      const near = nearness(p, eye, range, this.movers, this.moving)
      if (near === Infinity || parts.declared.holds(p.model, p.instance.node)) {
        parts.resident.evict(p)
        continue
      }
      p.near = near
      this.wanted[this.wants++] = p
      if (shape.seen !== this.pass) {
        shape.seen = this.pass
        shape.near = near
        this.tiles[this.tileCount++] = shape
      } else if (near < shape.near) shape.near = near
    }
    if (kept < placed.length) placed.length = kept
  }
  /** Whether placement `p`'s tile had its bytes counted by this update. */
  private readonly counted = (p: Placed) => p.shape.counted === this.pass
  /** Whether placement `p`, let in on its restored tile, waits for its body: none built, and not
   *  out for good. */
  private readonly waits = (p: Placed) => p.id < 0 && !p.out
  /** Builds the nearest bodies of the placements of `list[0, count)` that wait (`waits`), up to
   *  `BUILDS` and the slots left — another frame asked for the others past `BUILDS`. */
  private build(list: Placed[], count: number) {
    const waiting = partitionBy(list, count, this.waits),
      n = Math.min(waiting, BUILDS, this.parts.bodies.ledger.room('bodies'))
    if (n < waiting) selectNearest(list, waiting, n)
    if (waiting > BUILDS) this.parts.invalidate()
    for (let i = 0; i < n; i++) this.parts.resident.build(list[i])
    if (n > 0) this.keeps.unorder()
  }
  /** Tile `shape` restored as its bytes landed: the placements of it waiting built at once, then
   *  let go of — the others built by the next update. */
  private readonly landed = (shape: TileShape) => {
    this.build(shape.waiting, shape.waits)
    shape.waiting.length = shape.waits = 0
    this.parts.invalidate()
  }
}
