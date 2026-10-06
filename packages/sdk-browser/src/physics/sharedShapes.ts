import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
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
  /** The bytes it counts against the static collision's share while restored: a tile's; a
   *  declared body's hull, its own shape, counts none. */
  bytes: number
  /** Its handle in the module while restored, -1 while not. */
  handle: number
  /** The bodies built on it; and the placements and openings naming it. */
  users: number
  holders: number
  /** Its read in flight, and the abort its last holder leaving lets it go by. */
  read: Promise<Uint8Array> | null
  abort: AbortController | null
  /** The 4xx its object answered, reported once: not asked again while it is held. */
  refused: Error | null
  /** The last update that wanted it restored (`tileSchedule.ts`): kept through it bodiless. */
  wanted: number
  /** Listed for `settle`. */
  listed: boolean
}

/** What a session's cooked objects need: the writer of its commands, what counts the bytes of
 *  its shapes, and where a failed read is reported. */
type SharedParts = {
  writer: CommandWriter
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'countShape'>
  failed: (error: EngineError) => void
}

/**
 * The cooked objects a session's bodies are built from, one per kind and object however many
 * models, placements or bodies name it, while one holds it: read once, a failed read reported
 * once; a shape restored once under a handle of the session's ids (`createSimulatedIds`: a handle
 * taken again is another), its bytes counted once (`countShape`), and released by `settle` once
 * no body uses it — a tile once no update wants it, a hull once no opening holds it —, never
 * before nor twice.
 */
export class SharedShapes {
  /** The bytes the restored shapes count: the tiles'. */
  restoredBytes = 0
  private readonly known = new Map<string, SharedShape>()
  private readonly handles = createSimulatedIds<SharedShape>()
  /** Restored shapes whose users fell to zero, or none came yet: `settle` reads them. */
  private readonly bare: SharedShape[] = []
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
        ...{ refused: null, wanted: -1, listed: false, ...extra },
      }
      this.known.set(`${kind} ${url}`, shape)
    }
    shape.holders++
    return shape as SharedShape & E
  }
  /** A holder of `shape` gone: the last one lets its read go, a hull be released, and the shape
   *  be forgotten, refused or not. */
  letGo(shape: SharedShape) {
    if (--shape.holders) return
    shape.abort?.abort()
    shape.read = shape.abort = null
    this.list(shape)
    this.forget(shape)
  }
  /** `shape`'s object, read once for every caller (`readShared`), in `tries` requests. */
  read(shape: SharedShape, tries?: number) {
    return readShared(shape, this.parts.failed, tries)
  }
  /** `shape` restored, read first when it is not: a hull, which counts no bytes. */
  async restored(shape: SharedShape) {
    if (shape.handle < 0) this.restore(shape, await this.read(shape))
  }
  /** Restores `shape` from its object's `bytes` when they fit the share: whether it is restored. */
  restore(shape: SharedShape, bytes: Uint8Array) {
    if (shape.handle >= 0) return true
    if (!this.parts.bodies.countShape(shape.bytes)) return false
    shape.handle = this.handles.take(shape)
    this.parts.writer.restore(shape.handle, bytes)
    this.restoredBytes += shape.bytes
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
   *  of update `pass` wants. */
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
    this.restoredBytes -= shape.bytes
    shape.handle = -1
    this.forget(shape)
  }
  /** `shape` out of the registry once nothing holds it and it is not restored. */
  private forget(shape: SharedShape) {
    const key = `${shape.kind} ${shape.url}`
    if (!shape.holders && shape.handle < 0 && this.known.get(key) === shape) this.known.delete(key)
  }
}
