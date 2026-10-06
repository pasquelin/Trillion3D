import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { createModelBodies } from './modelBodies.ts'
import { partition, selectNearest } from './nearest.ts'
import type { SharedShapes } from './sharedShapes.ts'
import type { createResidentTiles } from './tileResident.ts'
import { moversOf, nearness, type Placed, type TileShape } from './tilePlace.ts'
import { ONE_REQUEST } from '../cluster/checked.ts'

/** Tile reads in flight at once. */
const FETCHES = 8
/** Tile reads one update starts at most: each lands as a restore in the worker's next step. */
const LOADS = 2
/** Tile bodies one update builds at most, nearest first: each an ADD in the worker's next step, so
 *  an eye arriving among a thousand placements of a resident tile adds them over frames. */
const BUILDS = 64

/** An open model's opening: its tiles, empty until its file lands, and the abort its leaving lets
 *  go of its file's read by — one back while it was on its way lands once, the later. */
export type TileOpening = { placed: Placed[]; abort: AbortController }

/** What a schedule reads and acts on: the session's bodies, the models' declared ones, the
 *  shared shapes and the tile bodies, and where it asks a frame and reports a failure. */
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
 * the tiles no one uses go. Only the U tiles wanted are sorted: the P placements (P ≫ U for a prop
 * repeated over a world) are only partitioned and selected, O(P) on average. Nothing is allocated
 * per update: the lists are scratch, kept from one to the next.
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

  constructor(parts: ScheduleParts) {
    this.parts = parts
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
    openings.forEach(this.collect)
    this.tiles.sort(byNear)
  }
  /**
   * Lets in the placements wanted within `free` bytes of the share and `slots` bodies: the tiles'
   * bytes counted once each, nearest tile first — past the first that does not fit, no farther one
   * is, the room kept for it; one past the whole share never fits, and holds no one back —, then
   * the `slots` nearest placements of the tiles counted. The others are evicted.
   */
  admit(free: number, slots: number) {
    const tiles = this.tiles,
      wanted = this.wanted
    let bytes = free
    for (let i = 0; i < tiles.length; i++) {
      const shape = tiles[i]
      if (shape.bytes > free) continue
      if (shape.bytes > bytes) break
      bytes -= shape.bytes
      shape.counted = this.pass
    }
    const counted = partition(wanted, 0, wanted.length, this.counted),
      n = Math.min(counted, Math.max(slots, 0))
    if (n < counted) selectNearest(wanted, counted, n)
    for (let i = 0; i < wanted.length; i++) {
      const p = wanted[i]
      p.out = i >= n
      if (p.out) this.parts.resident.evict(p)
      else p.shape.wanted = this.pass
    }
    this.in = n
  }
  /** Builds the `BUILDS` nearest bodies the placements let in wait for on their resident tiles,
   *  asking another frame for the others, and reads the `LOADS` nearest tiles still to read; then
   *  lets go of the tiles no one uses. */
  start() {
    const wanted = this.wanted,
      parts = this.parts
    const waiting = partition(wanted, 0, this.in, this.buildable)
    if (waiting > BUILDS) {
      selectNearest(wanted, waiting, BUILDS)
      parts.invalidate()
    }
    for (let i = 0; i < waiting && i < BUILDS; i++) parts.resident.build(wanted[i])
    const tiles = this.tiles
    for (let i = 0, loads = LOADS; i < tiles.length && loads && this.fetching < FETCHES; i++) {
      const shape = tiles[i]
      if (shape.wanted !== this.pass || shape.handle >= 0 || shape.read) continue
      loads--
      this.read(shape)
    }
    wanted.length = tiles.length = 0
    this.settle()
  }
  /** Lets go of the tiles no one uses, but those the last update let in. */
  settle() {
    this.parts.shapes.settle(this.pass)
  }
  /** Lists the placements of `opening` wanted, and their tiles, each with its nearest; evicts the
   *  others. */
  private readonly collect = (opening: { placed: Placed[] }) => {
    const placed = opening.placed,
      parts = this.parts
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i],
        shape = p.shape,
        near = nearness(p, this.eye, this.range, this.movers)
      if (near === Infinity || shape.refused || parts.declared.holds(p.model, p.instance.node)) {
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
  }
  /** Whether placement `p`'s tile had its bytes counted by this update. */
  private readonly counted = (p: Placed) => p.shape.counted === this.pass
  /** Whether placement `p` waits for its body on its resident tile. */
  private readonly buildable = (p: Placed) => p.id < 0 && p.shape.handle >= 0
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
  /** `shape`'s bytes landed: restored if the last update let it in and they fit, its bodies built
   *  by the next, asked at once; else they are let go, and it is read again once it fits. */
  private land(shape: TileShape, bytes: Uint8Array) {
    if (shape.holders && shape.wanted === this.pass && this.parts.shapes.restore(shape, bytes))
      this.parts.invalidate()
  }
}
