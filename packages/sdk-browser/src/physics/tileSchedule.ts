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
 * the tiles no one uses go. Only the U tiles wanted are sorted, the P placements (P ≫ U) only
 * partitioned and selected, O(P); nothing is allocated per update, the lists kept as scratch.
 */
export class TileSchedule {
  private readonly wanted: Placed[] = []
  private readonly tiles: TileShape[] = []
  private readonly movers: number[] = []
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
    moversOf(bodies.meshes, bodies.nested, bodies.state.velocity, this.movers)
    this.eye = eye
    this.range = range
    this.pass++
    this.wanted.length = this.tiles.length = 0
    openings.forEach(this.collect)
    this.tiles.sort(byNear)
  }
  /**
   * Lets in the placements wanted within `free` bytes of the share and `slots` bodies: the bytes
   * counted once each of the tiles the `slots` nearest placements name, nearest tile first — past
   * the first that does not fit, no farther one is, the room kept for it; one past the whole share
   * never fits, and holds no one back —, then the `slots` nearest placements of the tiles counted,
   * their tiles kept (`tileKeeps.ts`). The others are evicted, and the bytes landed for tiles
   * let in nowhere kept in the room left.
   */
  admit(free: number, slots: number) {
    const tiles = this.tiles,
      wanted = this.wanted,
      pass = this.pass,
      near = Math.min(wanted.length, Math.max(slots, 0))
    if (near < wanted.length) selectNearest(wanted, wanted.length, near)
    for (let i = 0; i < near; i++) wanted[i].shape.slotted = pass
    let bytes = free
    for (let i = 0; i < tiles.length; i++) {
      const shape = tiles[i]
      if (shape.slotted !== pass || shape.bytes > free) continue
      if (shape.bytes > bytes) break
      bytes -= shape.bytes
      shape.counted = pass
    }
    const counted = partitionBy(wanted, wanted.length, this.counted),
      n = Math.min(counted, near)
    if (n < counted) selectNearest(wanted, counted, n)
    for (let i = n; i < wanted.length; i++) this.parts.resident.evict(wanted[i])
    this.keeps.keep(wanted, n, pass)
    this.keeps.trim(bytes, pass)
    this.in = n
  }
  /** Builds the bodies the placements let in wait for on their resident tiles (`build`), and
   *  reads the `LOADS` nearest tiles still to read; then lets go of the tiles no one uses. */
  start() {
    this.build(this.buildable)
    const tiles = this.tiles
    for (let i = 0, loads = LOADS; i < tiles.length && loads && this.fetching < FETCHES; i++) {
      const shape = tiles[i]
      // Its read in flight, it waits; landed and kept, it is restored now, nothing asked again.
      if (shape.kept !== this.pass || shape.handle >= 0 || shape.abort) continue
      loads--
      this.read(shape)
    }
    this.parts.shapes.settle()
  }
  /** Evicts the farthest tile body the last update let in, for a body that needs its slot. */
  evictFarthest() {
    this.keeps.evictFarthest(this.wanted, this.in)
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
      if (shape.refused) {
        parts.resident.remove(p)
        continue
      }
      placed[(p.at = kept++)] = p
      const near = nearness(p, this.eye, this.range, this.movers)
      if (near === Infinity || parts.declared.holds(p.model, p.instance.node)) {
        parts.resident.evict(p)
        continue
      }
      p.near = near
      this.wanted.push(p)
      if (shape.seen !== this.pass) {
        shape.seen = this.pass
        shape.near = near
        this.tiles.push(shape)
      } else if (near < shape.near) shape.near = near
    }
    placed.length = kept
  }
  /** Whether placement `p`'s tile had its bytes counted by this update. */
  private readonly counted = (p: Placed) => p.shape.counted === this.pass
  /** Whether placement `p` waits for its body on its resident tile; on the tile just landed. */
  private readonly buildable = (p: Placed) => p.id < 0 && p.shape.handle >= 0
  private readonly onLanded = (p: Placed) => p.id < 0 && p.shape === this.landed
  private landed: TileShape | null = null
  /** Builds the `BUILDS` nearest bodies of the placements let in that `waits` holds, asking
   *  another frame for the others. */
  private build(waits: (p: Placed) => boolean) {
    const wanted = this.wanted,
      waiting = partitionBy(wanted, this.in, waits)
    if (waiting > BUILDS) {
      selectNearest(wanted, waiting, BUILDS)
      this.parts.invalidate()
    }
    for (let i = 0; i < waiting && i < BUILDS; i++) this.parts.resident.build(wanted[i])
  }
  /** One request: a tile still wanted is asked again at the next update, but for a 4xx; a read
   *  that cannot land is a failure. */
  private read(shape: TileShape) {
    const parts = this.parts
    this.fetching++
    void parts.shapes
      .read(shape, ONE_REQUEST)
      // A failed read is reported by the registry, once.
      .then(
        (bytes) => this.land(shape, bytes),
        () => {},
      )
      .catch((error) => parts.failed(error as EngineError))
      .finally(() => this.fetching--)
  }
  /** `shape`'s bytes landed: restored if the last update let it in, else kept for one that does,
   *  and its placements let in built at once — no frame may come before a query or a step. */
  private land(shape: TileShape, bytes: Uint8Array) {
    if (!shape.holders || shape.kept !== this.pass) return
    try {
      this.parts.shapes.restore(shape, bytes)
      this.landed = shape
      this.build(this.onLanded)
    } catch (error) {
      // Its room, or a slot, taken meanwhile: the rest waits for the next update.
      if ((error as EngineError).code !== 'PHYSICS_BUDGET') throw error
    }
    this.parts.invalidate()
  }
}
