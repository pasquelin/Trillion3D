import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { createModelBodies } from './modelBodies.ts'
import { partitionBy } from '../../../sdk-core/src/math/select.ts'
import type { SharedShapes } from './sharedShapes.ts'
import { createTileKeeps } from './tileKeeps.ts'
import type { createResidentTiles } from './tileResident.ts'
import { moversOf, nearness, selectNearest, type Placed, type TileShape } from './tilePlace.ts'
import { ONE_REQUEST } from '../cluster/checked.ts'

/** Tile reads in flight at once. */
const FETCHES = 8
/** Tile reads one update starts at most: each lands as a restore in the worker's next step. */
const LOADS = 2
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

/**
 * What an update does for the tiles: `want` lists the placements wanted and their tiles, each tile
 * by its nearest placement; `admit` lets in those that fit; `start` builds their bodies on their
 * resident tiles and reads the others, nearest first within the caps — `FETCHES` reads in flight,
 * `LOADS` reads and `BUILDS` bodies an update, another frame asked while bodies wait —, then lets
 * the tiles no one uses go; a tile restored as its bytes land builds its placements' bodies at
 * once, from its own waiting list. Only the U tiles wanted are sorted, the P placements (P ≫ U)
 * only partitioned and selected, O(P); nothing is allocated per update, the lists kept as scratch,
 * each with its count.
 */
export class TileSchedule {
  private readonly wanted: Placed[] = []
  private wants = 0
  private readonly tiles: TileShape[] = []
  private tileCount = 0
  private readonly movers: number[] = []
  private moving = 0
  private fetching = 0
  private pass = 0
  /** The placements the last `admit` let in: the front of `wanted`. */
  private in = 0
  private eye: ArrayLike<number> = []
  private range = 0
  private readonly parts: ScheduleParts
  private readonly keeps: ReturnType<typeof createTileKeeps>

  constructor(parts: ScheduleParts) {
    this.parts = parts
    this.keeps = createTileKeeps(parts.shapes, parts.resident.evict)
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
    this.eye = eye
    this.range = range
    this.pass++
    this.wants = this.tileCount = 0
    openings.forEach(this.collect)
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
    this.keeps.keep(wanted, n, pass)
    this.in = n
  }
  /** Builds the bodies the placements let in wait for on their resident tiles (`build`), and
   *  reads the `LOADS` nearest tiles still to read; then lets go of the tiles no one uses. */
  start() {
    this.build(this.wanted, this.in)
    const tiles = this.tiles
    for (let i = 0, loads = LOADS; i < tiles.length && loads && this.fetching < FETCHES; i++) {
      const shape = tiles[i]
      // Its read in flight, it waits.
      if (shape.kept !== this.pass || shape.handle >= 0 || shape.read) continue
      loads--
      this.read(shape)
    }
    this.parts.shapes.settle()
  }
  /** Evicts the farthest tile body the last update let in, for a body that needs its slot. */
  evictFarthest() {
    this.keeps.evictFarthest(this.wanted, this.in, this.pass)
  }
  /** Lists the placements of `opening` wanted, and their tiles, each with its nearest; evicts the
   *  others, and takes those of a refused tile out of `opening` for good, its model's opening. */
  private readonly collect = (opening: { placed: Placed[] }) => {
    const placed = opening.placed,
      parts = this.parts
    let kept = 0
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i],
        shape = p.shape
      if (shape.refused) parts.resident.remove(p)
      // Out for good — its tile or its body refused —: out of its opening.
      if (p.left === Infinity) continue
      placed[kept++] = p
      const near = nearness(p, this.eye, this.range, this.movers, this.moving)
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
  /** Whether placement `p`, let in, waits for its body on its restored tile: none built, none
   *  taken from it by this update for another body's slot, and not out for good. */
  private readonly waits = (p: Placed) => p.id < 0 && p.shape.handle >= 0 && p.left < this.pass
  /** Whether the last update let tile `shape` in. */
  private readonly admitted = (shape: TileShape) => shape.kept === this.pass
  /** Builds the `BUILDS` nearest bodies of the placements of `list[0, count)` that wait (`waits`),
   *  asking another frame for the others; a slot taken meanwhile leaves the rest to the next
   *  update. */
  private build(list: Placed[], count: number) {
    const waiting = partitionBy(list, count, this.waits)
    if (waiting > BUILDS) {
      selectNearest(list, waiting, BUILDS)
      this.parts.invalidate()
    }
    try {
      for (let i = 0; i < waiting && i < BUILDS; i++) this.parts.resident.build(list[i])
    } catch (error) {
      if ((error as EngineError).code !== 'PHYSICS_BUDGET') throw error
    }
  }
  /** One request, the tile restored as its bytes land if the last update let it in (`restored`),
   *  else dropped; restored, the placements of it waiting have their bodies built at once — no
   *  frame may come before a query or a step. A tile still wanted is asked again at the next
   *  update, but for a 4xx; a failure is reported by the registry, once. */
  private read(shape: TileShape) {
    const parts = this.parts
    this.fetching++
    void parts.shapes
      .restored(shape, this.admitted, ONE_REQUEST)
      .then((restored) => {
        if (!restored) return
        this.build(shape.waiting, shape.waits)
        parts.invalidate()
      })
      .catch((error) => parts.failed(error as EngineError))
      .finally(() => this.fetching--)
  }
}
