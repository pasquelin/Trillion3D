import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { createSimulatedIds } from './simulatedIds.ts'
import { cookedBytes } from './tilePlace.ts'
import { retriableError } from '../cluster/checked.ts'

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
  /** The bodies built on it: the last one leaving lets `settle` release it. */
  users: number
  /** The placements and openings naming it: once none does, its read is let go and it is
   *  forgotten. */
  holders: number
  /** Its read in flight — a soft body's settings, its read landed, kept while held —, and the
   *  abort its last holder leaving lets it go by. */
  read: Promise<Uint8Array> | null
  abort: AbortController | null
  /** Its object answered a 4xx, or the worker refused a body built on it: no body is built on it
   *  while it is held. */
  refused: boolean
  /** The last update that wanted it restored (`tileSchedule.ts`): kept through it bodiless. */
  wanted: number
}

/** What counts a shape's bytes against the static collision's share (`bodies.ts`). */
type ShapeCount = Pick<ReturnType<typeof createPhysicsBodies>, 'countShape'>

/**
 * The cooked objects a session's bodies are built from, one per kind and object however many
 * models, placements or bodies name it: read once while a holder wants it; a shape restored once
 * under a handle of the session's ids (`createSimulatedIds`: a handle taken again is another), its
 * bytes counted once (`countShape`), and released by `settle` once its users fell to zero — never
 * before, and never twice.
 */
export class SharedShapes {
  /** The bytes the restored tiles count: those the tiles' own streaming gives back. */
  tileBytes = 0
  private readonly known = new Map<string, SharedShape>()
  private readonly handles = createSimulatedIds<SharedShape>()
  /** Restored shapes whose users fell to zero, or none came yet: `settle` reads them. */
  private readonly bare: SharedShape[] = []
  private readonly writer: CommandWriter
  private readonly bodies: ShapeCount

  constructor(writer: CommandWriter, bodies: ShapeCount) {
    this.writer = writer
    this.bodies = bodies
  }
  /** The `kind` object at `url`, held: made counting `bytes`, with `extra`, when new. */
  hold<E extends object>(kind: CookedKind, url: string, bytes: number, extra: E) {
    let shape = this.known.get(`${kind} ${url}`)
    if (!shape) {
      shape = {
        ...{ kind, url, bytes, handle: -1, users: 0, holders: 0 },
        ...{ read: null, abort: null, refused: false, wanted: -1, ...extra },
      }
      this.known.set(`${kind} ${url}`, shape)
    }
    shape.holders++
    return shape as SharedShape & E
  }
  /** A holder of `shape` gone: the last one lets its read go. */
  letGo(shape: SharedShape) {
    if (--shape.holders) return
    shape.abort?.abort()
    shape.read = shape.abort = null
    this.forget(shape)
  }
  /** `shape`'s object, read once — `tries` requests — for every caller until it lands; landed,
   *  the next caller asks it again, but settings, kept; failed, again, but a 4xx, refused. */
  read(shape: SharedShape, tries?: number) {
    if (shape.read) return shape.read
    const abort = new AbortController()
    const read = cookedBytes(shape.url, abort.signal, tries)
    const settled = (error?: unknown) => {
      if (abort.signal.aborted || shape.read !== read) return
      if (error === undefined && shape.kind === 'settings') return
      shape.read = null
      shape.refused = error !== undefined && !retriableError(error)
    }
    read.then(() => settled(), settled)
    shape.read = read
    shape.abort = abort
    return read
  }
  /** `shape` restored, read first when it is not; refused by name when its bytes do not fit. */
  async restored(shape: SharedShape) {
    if (shape.handle >= 0 || this.restore(shape, await this.read(shape))) return
    throw new EngineError(
      'PHYSICS_BUDGET',
      `The cooked shape ${shape.url} does not fit the static collision's share (world.budget.physics.memoryBytes).`,
      { budget: 'memoryBytes', requested: shape.bytes },
    )
  }
  /** Restores `shape` from its object's `bytes` when they fit the share: whether it is restored. */
  restore(shape: SharedShape, bytes: Uint8Array) {
    if (shape.handle >= 0) return true
    if (!this.bodies.countShape(shape.bytes)) return false
    shape.handle = this.handles.take(shape)
    this.writer.restore(shape.handle, bytes)
    if (shape.kind === 'tile') this.tileBytes += shape.bytes
    this.bare.push(shape)
    return true
  }
  /** A body built on `shape`. */
  use(shape: SharedShape) {
    shape.users++
  }
  /** A body built on `shape` left: the last one lets `settle` release it. */
  done(shape: SharedShape) {
    if (!--shape.users) this.bare.push(shape)
  }
  /** Releases every restored shape no body uses, but one a holder of update `pass` wants: its
   *  handle dropped, its bytes given back. A shape listed twice is released once. */
  settle(pass: number) {
    const bare = this.bare
    let kept = 0
    for (let i = 0; i < bare.length; i++) {
      const shape = bare[i]
      if (shape.users || shape.handle < 0) continue
      else if (shape.holders && shape.wanted === pass) bare[kept++] = shape
      else this.release(shape)
    }
    bare.length = kept
  }
  private release(shape: SharedShape) {
    if (shape.handle < 0 || this.handles.of(shape.handle) !== shape) return
    this.writer.release(shape.handle)
    this.handles.release(shape.handle)
    this.bodies.countShape(-shape.bytes)
    if (shape.kind === 'tile') this.tileBytes -= shape.bytes
    shape.handle = -1
    this.forget(shape)
  }
  /** `shape` out of the registry once nothing holds it and it is not restored. */
  private forget(shape: SharedShape) {
    const key = `${shape.kind} ${shape.url}`
    if (!shape.holders && shape.handle < 0 && this.known.get(key) === shape) this.known.delete(key)
  }
}
