import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { createSimulatedIds } from './simulatedIds.ts'
import { cookedBytes } from './tilePlace.ts'
import { retriableError } from '../cluster/checked.ts'

/** A cooked shape the session's bodies share: one per cooked object, by its absolute URL. */
export interface SharedShape {
  url: string
  /** The bytes it counts against the static collision's share while restored. */
  bytes: number
  /** Its handle in the module while restored, -1 while not. */
  handle: number
  /** What keeps it restored: the bodies built on it, or the openings whose bodies it shapes. */
  users: number
  /** The placements and openings naming it: once none does, its read is let go and it is
   *  forgotten. */
  holders: number
  /** Its read in flight, and the abort its last holder leaving lets it go by. */
  read: Promise<Uint8Array> | null
  abort: AbortController | null
  /** Its object answered a 4xx: not asked again while it is held. */
  absent: boolean
  /** The last update that wanted it restored (`tileSchedule.ts`): kept through it bodiless. */
  wanted: number
}

/** What counts a shape's bytes against the static collision's share (`bodies.ts`). */
type ShapeCount = Pick<ReturnType<typeof createPhysicsBodies>, 'countShape'>

/**
 * The cooked shapes restored in the physics module for a session, one per object however many
 * models, placements or bodies name it: read once while a holder wants it, restored once under a
 * handle of the session's ids (`createSimulatedIds`: a handle taken again is another), its bytes
 * counted once (`countShape`), released by `settle` once its users fell to zero — never before,
 * and never twice.
 */
export class SharedShapes {
  /** The bytes the restored shapes count. */
  heldBytes = 0
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
  /** The shape of the object at `url`, held: made with `bytes` and `extra` when new. */
  hold<E extends object>(url: string, bytes: number, extra: E) {
    let shape = this.known.get(url)
    if (!shape) {
      shape = {
        ...{ url, bytes, handle: -1, users: 0, holders: 0 },
        ...{ read: null, abort: null, absent: false, wanted: -1, ...extra },
      }
      this.known.set(url, shape)
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
  /** `shape`'s object, read once — `tries` requests — for every caller until it lands; landed
   *  or failed, the next caller asks it again, but a 4xx, never asked again while it is held. */
  read(shape: SharedShape, tries?: number) {
    if (shape.read) return shape.read
    const abort = new AbortController()
    const read = cookedBytes(shape.url, abort.signal, tries)
    const settled = (error?: unknown) => {
      if (abort.signal.aborted || shape.read !== read) return
      shape.read = null
      shape.absent = error !== undefined && !retriableError(error)
    }
    read.then(() => settled(), settled)
    shape.read = read
    shape.abort = abort
    return read
  }
  /** `shape` restored, read first when it is not: one counting no bytes, which always fit. */
  async restored(shape: SharedShape) {
    if (shape.handle < 0) this.restore(shape, await this.read(shape))
  }
  /** Restores `shape` from its object's `bytes` when its bytes fit: whether it is restored. */
  restore(shape: SharedShape, bytes: Uint8Array) {
    if (shape.handle >= 0) return true
    if (!this.bodies.countShape(shape.bytes)) return false
    shape.handle = this.handles.take(shape)
    this.writer.restore(shape.handle, bytes)
    this.heldBytes += shape.bytes
    this.bare.push(shape)
    return true
  }
  /** A user of `shape` came. */
  use(shape: SharedShape) {
    shape.users++
  }
  /** A user of `shape` left: the last one lets `settle` release it. */
  done(shape: SharedShape) {
    if (!--shape.users) this.bare.push(shape)
  }
  /** Releases every restored shape no one uses, but one a holder of update `pass` wants: its
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
    this.heldBytes -= shape.bytes
    shape.handle = -1
    this.forget(shape)
  }
  /** `shape` out of the registry once nothing holds it and it is not restored. */
  private forget(shape: SharedShape) {
    if (!shape.holders && shape.handle < 0 && this.known.get(shape.url) === shape)
      this.known.delete(shape.url)
  }
}
