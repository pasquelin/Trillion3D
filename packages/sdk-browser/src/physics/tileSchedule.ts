import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { createModelBodies } from './modelBodies.ts'
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

const byNear = (a: Placed, b: Placed) => a.near - b.near

/**
 * What an update does for the tiles, in three steps: `want` lists the placements wanted, nearest
 * first, the others evicted; `admit` lets in those that fit; `start` builds their bodies on their
 * resident tiles and reads the others, within the caps — `FETCHES` reads in flight, `LOADS` reads
 * and `BUILDS` bodies an update —, then lets the tiles no one uses go. Nothing is allocated per
 * update: the placements wanted are a scratch list sorted by their own nearness.
 */
export class TileSchedule {
  private readonly wanted: Placed[] = []
  private readonly movers: number[] = []
  private fetching = 0
  private pass = 0
  private eye: ArrayLike<number> = []
  private range = 0
  private readonly bodies: ReturnType<typeof createPhysicsBodies>
  private readonly declared: ReturnType<typeof createModelBodies>
  private readonly shapes: SharedShapes
  private readonly resident: ReturnType<typeof createResidentTiles>
  private readonly invalidate: () => void
  private readonly failed: (error: EngineError) => void

  constructor(
    bodies: ReturnType<typeof createPhysicsBodies>,
    declared: ReturnType<typeof createModelBodies>,
    shapes: SharedShapes,
    resident: ReturnType<typeof createResidentTiles>,
    invalidate: () => void,
    failed: (error: EngineError) => void,
  ) {
    this.bodies = bodies
    this.declared = declared
    this.shapes = shapes
    this.resident = resident
    this.invalidate = invalidate
    this.failed = failed
  }
  /** Lists the placements of `openings` wanted around `eye` within `range` and the moving bodies
   *  (`nearness`), nearest first; one unwanted, absent, or whose node a declared body holds, is
   *  evicted. */
  want(
    openings: ReadonlyMap<unknown, { placed: Placed[] }>,
    eye: ArrayLike<number>,
    range: number,
  ) {
    const bodies = this.bodies
    moversOf(bodies.meshes, bodies.nested, bodies.state.velocity, this.movers)
    this.eye = eye
    this.range = range
    openings.forEach(this.collect)
    this.wanted.sort(byNear)
  }
  /**
   * Lets in, nearest first, the placements wanted within `free` bytes of the share and `slots`
   * bodies: a tile's bytes counted once, at its nearest placement; each placement one body. Past
   * the first tile whose bytes do not fit, no other tile's are counted — the room kept for it —,
   * but the placements of a tile counted already still come in while bodies remain; a tile past
   * the whole share never fits, and holds no one back. The others are evicted.
   */
  admit(free: number, slots: number) {
    const wanted = this.wanted,
      pass = ++this.pass
    let bytes = free,
      stopped = false
    for (let i = 0; i < wanted.length; i++) {
      const p = wanted[i],
        shape = p.shape,
        fresh = shape.wanted !== pass
      if (fresh && shape.bytes <= free && shape.bytes > bytes) stopped = true
      p.out = slots < 1 || (fresh && (stopped || shape.bytes > free))
      if (p.out) {
        this.resident.evict(p)
        continue
      }
      if (fresh) bytes -= shape.bytes
      shape.wanted = pass
      slots--
    }
  }
  /** Builds the bodies of the placements let in on their resident tiles and reads the others,
   *  nearest first, until the caps are spent; then lets go of the tiles no one uses. */
  start() {
    const wanted = this.wanted
    let loads = LOADS,
      builds = BUILDS
    for (let i = 0; i < wanted.length && (builds || (loads && this.fetching < FETCHES)); i++) {
      const p = wanted[i],
        shape = p.shape
      if (p.out || p.id >= 0) continue
      if (shape.handle >= 0) {
        if (!builds) continue
        builds--
        this.resident.build(p)
      } else if (loads && this.fetching < FETCHES && !shape.read) {
        loads--
        this.read(shape)
      }
    }
    wanted.length = 0
    this.settle()
  }
  /** Lets go of the tiles no one uses, but those the last update admitted. */
  settle() {
    this.shapes.settle(this.pass)
  }
  /** Lists the placements of `opening` wanted, their nearness kept; evicts the others. */
  private readonly collect = (opening: { placed: Placed[] }) => {
    const placed = opening.placed
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i],
        near = nearness(p, this.eye, this.range, this.movers)
      if (near === Infinity || p.shape.absent || this.declared.holds(p.model, p.instance.node))
        this.resident.evict(p)
      else {
        p.near = near
        this.wanted.push(p)
      }
    }
  }
  /** One request: a tile still wanted is asked again at the next update, but for a 4xx; a read
   *  its last holder let go of is no failure. */
  private read(shape: TileShape) {
    this.fetching++
    void this.shapes
      .read(shape, ONE_REQUEST)
      .then(
        (bytes) => this.land(shape, bytes),
        (error) => shape.holders && this.failed(error as EngineError),
      )
      .finally(() => this.fetching--)
  }
  /** `shape`'s bytes landed: restored if the last update admitted it and they fit, its bodies
   *  built by the next; else they are let go, and it is read again once it fits. */
  private land(shape: TileShape, bytes: Uint8Array) {
    if (shape.holders && shape.wanted === this.pass && this.shapes.restore(shape, bytes))
      this.invalidate()
  }
}
