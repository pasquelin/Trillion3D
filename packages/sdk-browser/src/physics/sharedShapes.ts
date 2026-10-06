import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { createSimulatedIds } from './simulatedIds.ts'
import { readShared } from './cookedReads.ts'

/** What a cooked object is to the bodies built from it: a tile's or a hull's shape, restored in
 *  the module; or a soft body's settings, written whole into each one made from them. */
export type CookedKind = 'tile' | 'hull' | 'settings'

/** A cooked object the session's bodies share: one per kind and absolute URL. */
export interface SharedShape {
  kind: CookedKind
  url: string
  /** The bytes it counts against the static collision's share while restored. */
  bytes: number
  /** Its handle in the module while restored, -1 while not. */
  handle: number
  /** The bodies built on it; and the placements and openings naming it. */
  users: number
  holders: number
  /** Its read: in flight, with the abort its last holder leaving lets it go by; or landed and
   *  kept, a soft body's settings, for every body made from them in the session. */
  read: Promise<Uint8Array> | null
  abort: AbortController | null
  /** The 4xx its object answered, reported once: never asked again in the session. */
  refused: Error | null
  /** The last update that wanted it restored (`tileSchedule.ts`): kept through it bodiless. */
  wanted: number
  /** Listed for `settle`; and, past the room the tiles leave, waiting for them to leave more. */
  listed: boolean
  waiting: Promise<void> | null
}

/** What a session's cooked objects need: the writer of its commands, its bodies' count, the
 *  static collision's share, and where to ask a frame and report a failure. */
type SharedParts = {
  writer: CommandWriter
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'countShape' | 'count'>
  share: number
  invalidate: () => void
  failed: (error: EngineError) => void
}

/**
 * The cooked objects a session's bodies are built from, one per kind and object however many
 * models, placements or bodies name it: read once, a failed read reported once; a shape restored
 * once under a handle of the session's ids (`createSimulatedIds`: a handle taken again is
 * another), its bytes counted once (`countShape`), and released by `settle` once no body uses it
 * — a tile once no update wants it, a hull once no opening holds it —, never before nor twice.
 * The streamed tiles hold only the room the others leave: a hull past it waits, counted in
 * `demand`, for the tiles' next update to leave it room.
 */
export class SharedShapes {
  /** The bytes the restored tiles count, and those the hulls waiting for room ask. */
  tileBytes = 0
  demand = 0
  private readonly known = new Map<string, SharedShape>()
  private readonly handles = createSimulatedIds<SharedShape>()
  /** Restored shapes whose users fell to zero, or none came yet: `settle` reads them. */
  private readonly bare: SharedShape[] = []
  private readonly queue: { shape: SharedShape; bytes: Uint8Array; done: () => void }[] = []
  private readonly parts: SharedParts

  constructor(parts: SharedParts) {
    this.parts = parts
  }
  /** The `kind` object at `url`, held: made counting `bytes`, with `extra`, when new. */
  hold<E extends object>(kind: CookedKind, url: string, bytes: number, extra: E) {
    let shape = this.known.get(`${kind} ${url}`)
    if (!shape) {
      shape = {
        ...{ kind, url, bytes, handle: -1, users: 0, holders: 0, read: null, abort: null },
        ...{ refused: null, wanted: -1, listed: false, waiting: null, ...extra },
      }
      this.known.set(`${kind} ${url}`, shape)
    }
    shape.holders++
    return shape as SharedShape & E
  }
  /** A holder of `shape` gone: the last one lets its read in flight go, and a hull be released. */
  letGo(shape: SharedShape) {
    if (--shape.holders) return
    if (shape.abort) {
      shape.abort.abort()
      shape.read = shape.abort = null
    }
    this.list(shape)
    this.forget(shape)
  }
  /** `shape`'s object, read once for every caller (`readShared`), in `tries` requests. */
  read(shape: SharedShape, tries?: number) {
    return readShared(shape, this.parts.failed, tries)
  }
  /** `shape` restored, read first when it is not. Past the room the tiles leave, it waits for
   *  them to leave more; past the room even none would leave, it is refused by name. */
  async restored(shape: SharedShape) {
    if (shape.handle >= 0) return
    const bytes = await this.read(shape)
    if (shape.waiting) return shape.waiting
    if (this.restore(shape, bytes)) return
    const { bodies, share } = this.parts
    if (bodies.count.collisionBytes - this.tileBytes + this.demand + shape.bytes > share)
      throw new EngineError(
        'PHYSICS_BUDGET',
        `The cooked shape ${shape.url} does not fit the static collision's share (world.budget.physics.memoryBytes).`,
        { budget: 'memoryBytes', requested: shape.bytes },
      )
    this.demand += shape.bytes
    shape.waiting = new Promise((done) => this.queue.push({ shape, bytes, done }))
    this.parts.invalidate()
    return shape.waiting
  }
  /** Restores `shape` from its object's `bytes` when they fit the share: whether it is restored. */
  restore(shape: SharedShape, bytes: Uint8Array) {
    if (shape.handle >= 0) return true
    if (!this.parts.bodies.countShape(shape.bytes)) return false
    shape.handle = this.handles.take(shape)
    this.parts.writer.restore(shape.handle, bytes)
    if (shape.kind === 'tile') this.tileBytes += shape.bytes
    this.list(shape)
    return true
  }
  /** A body built on `shape`. */
  use(shape: SharedShape) {
    shape.users++
  }
  /** A body built on `shape` left: the last one lists it for `settle`. */
  done(shape: SharedShape) {
    if (!--shape.users) this.list(shape)
  }
  /** Releases every restored shape no body uses, but a hull an opening holds and a tile a holder
   *  of update `pass` wants; then restores the hulls waiting, in the room the tiles left. */
  settle(pass: number) {
    const bare = this.bare
    let kept = 0
    for (let i = 0; i < bare.length; i++) {
      const shape = bare[i]
      // Released already, or built on again; a hull an opening holds lives on, listed again once
      // let go of; a tile the last update wants stays, bodiless, to be built on next.
      if (shape.handle < 0 || shape.users || (shape.holders && shape.kind !== 'tile'))
        shape.listed = false
      else if (shape.holders && shape.wanted === pass) bare[kept++] = shape
      else {
        shape.listed = false
        this.release(shape)
      }
    }
    bare.length = kept
    this.retry()
  }
  /** The hulls waiting for room restored now it is there; one no opening holds any more, let go. */
  private retry() {
    let kept = 0
    for (const wait of this.queue)
      if (!wait.shape.holders || this.restore(wait.shape, wait.bytes)) {
        this.demand -= wait.shape.bytes
        wait.shape.waiting = null
        wait.done()
      } else this.queue[kept++] = wait
    this.queue.length = kept
  }
  /** `shape` listed for `settle`, once. */
  private list(shape: SharedShape) {
    if (shape.listed) return
    shape.listed = true
    this.bare.push(shape)
  }
  private release(shape: SharedShape) {
    if (shape.handle < 0 || this.handles.of(shape.handle) !== shape) return
    this.parts.writer.release(shape.handle)
    this.handles.release(shape.handle)
    this.parts.bodies.countShape(-shape.bytes)
    if (shape.kind === 'tile') this.tileBytes -= shape.bytes
    shape.handle = -1
    this.forget(shape)
  }
  /** `shape` out of the registry once nothing holds it, it is not restored, and it keeps neither
   *  a refusal nor landed settings for the session. */
  private forget(shape: SharedShape) {
    const key = `${shape.kind} ${shape.url}`
    if (shape.holders || shape.handle >= 0 || shape.refused || shape.read) return
    if (this.known.get(key) === shape) this.known.delete(key)
  }
}
