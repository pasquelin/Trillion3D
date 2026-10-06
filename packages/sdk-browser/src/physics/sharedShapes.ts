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
  /** The bytes it counts against the static collision's share, landed or restored: a tile's; a
   *  declared body's hull, its own shape, counts none. */
  bytes: number
  /** Its handle in the module while restored, -1 while not. */
  handle: number
  /** What keeps it restored — the bodies built on it, and who keeps it for them —; and the
   *  placements and openings naming it, which keep its read and its bytes. */
  users: number
  holders: number
  /** Its read in flight, and the abort its last holder leaving lets it go by. */
  read: Promise<Uint8Array> | null
  abort: AbortController | null
  /** Its bytes landed, counted against the share, kept while it is held until restored. */
  landed: Uint8Array | null
  /** Its object answered a 4xx: not asked again while it is held. */
  refused: boolean
  /** Listed for `settle`. */
  listed: boolean
}

/** What a session's cooked objects need: the writer of its commands, the ledger their bytes are
 *  claimed in, and where a failed read or restore is reported. */
type SharedParts = {
  writer: CommandWriter
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'claimShape' | 'releaseShape'>
  failed: (error: EngineError) => void
}

/**
 * The cooked objects a session's bodies are built from, one per kind and object however many
 * models, placements or bodies name it, while one holds it: read once, a failed read reported
 * once; its bytes landed kept, counted against the share (`claimShape`) when they fit; a shape
 * restored once under a handle of the session's ids (`createSimulatedIds`: a handle taken again is
 * another), and released by `settle` once no user keeps it or nothing holds it — never before,
 * and never twice.
 */
export class SharedShapes {
  /** The shapes whose bytes landed and wait, counted, to be restored. */
  readonly landedShapes: SharedShape[] = []
  private readonly known = new Map<string, SharedShape>()
  private readonly handles = createSimulatedIds<SharedShape>()
  /** Restored shapes whose users fell to zero, or none came yet: `settle` reads them. */
  private readonly bare: SharedShape[] = []
  private readonly parts: SharedParts

  constructor(parts: SharedParts) {
    this.parts = parts
  }
  /** The `kind` object at `url`, held by `holders` more: made counting `bytes`, with `extra`, when
   *  new. */
  hold<E extends object>(kind: CookedKind, url: string, bytes: number, extra: E, holders = 1) {
    let shape = this.known.get(`${kind} ${url}`)
    if (!shape) {
      shape = {
        ...{ kind, url, bytes, handle: -1, users: 0, holders: 0, read: null, abort: null },
        ...{ landed: null, refused: false, listed: false, ...extra },
      }
      this.known.set(`${kind} ${url}`, shape)
    }
    shape.holders += holders
    return shape as SharedShape & E
  }
  /** A holder of `shape` gone: the last one lets its read and its landed bytes go, and the shape
   *  be forgotten, refused or not, once released. */
  letGo(shape: SharedShape) {
    if (--shape.holders) return
    shape.abort?.abort()
    shape.read = shape.abort = null
    this.drop(shape)
    this.list(shape)
    this.forget(shape)
  }
  /** `shape`'s object, read once for every caller (`readShared`), in `tries` requests; landed,
   *  its bytes are kept, counted, while it is held and they fit. */
  read(shape: SharedShape, tries?: number) {
    if (shape.landed) return Promise.resolve(shape.landed)
    if (shape.read) return shape.read
    const read = readShared(shape, this.parts.failed, tries)
    read.then(
      (bytes) => this.keep(shape, bytes),
      () => {},
    )
    return read
  }
  /** Whether `shape` is restored, read first when it is not: false when its read or its restore
   *  failed, reported once here. */
  async restored(shape: SharedShape) {
    if (shape.handle >= 0) return true
    const bytes = await this.read(shape).catch(() => null)
    try {
      // No restore without a holder: one that let go meanwhile wants none.
      if (bytes && shape.holders) this.restore(shape, bytes)
    } catch (error) {
      this.parts.failed(error as EngineError)
    }
    return shape.handle >= 0
  }
  /** Restores `shape` from its object's `bytes`, counted when they were not yet (`claimShape`):
   *  refused past the share. */
  restore(shape: SharedShape, bytes: Uint8Array) {
    if (shape.handle >= 0) return
    if (!shape.landed) this.parts.bodies.claimShape(shape, shape.bytes)
    shape.handle = this.handles.take(shape)
    this.parts.writer.restore(shape.handle, bytes)
    this.unland(shape)
    this.list(shape)
  }
  /** `shape`'s landed bytes let go of, and their count given back. */
  drop(shape: SharedShape) {
    if (!shape.landed) return
    this.parts.bodies.releaseShape(shape)
    this.unland(shape)
  }
  /** A user keeps `shape` restored: a body built on it, or who keeps it for them. */
  use(shape: SharedShape) {
    shape.users++
  }
  /** A user of `shape` left: the last one lists it for `settle`. */
  done(shape: SharedShape) {
    if (!--shape.users) this.list(shape)
  }
  /** Releases every restored shape no user keeps any more, or nothing holds any more. */
  settle() {
    const bare = this.bare
    for (let i = 0; i < bare.length; i++) {
      bare[i].listed = false
      if (!bare[i].users || !bare[i].holders) this.release(bare[i])
    }
    bare.length = 0
  }
  /** `bytes` landed for `shape`: kept while it is held, counted when they fit, else let go. */
  private keep(shape: SharedShape, bytes: Uint8Array) {
    if (!shape.holders || shape.handle >= 0 || shape.landed) return
    try {
      this.parts.bodies.claimShape(shape, shape.bytes)
    } catch {
      return
    }
    shape.landed = bytes
    this.landedShapes.push(shape)
  }
  private unland(shape: SharedShape) {
    shape.landed = null
    const at = this.landedShapes.indexOf(shape)
    if (at >= 0) this.landedShapes.splice(at, 1)
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
    this.parts.bodies.releaseShape(shape)
    shape.handle = -1
    this.forget(shape)
  }
  /** `shape` out of the registry once nothing holds it and it is not restored. */
  private forget(shape: SharedShape) {
    const key = `${shape.kind} ${shape.url}`
    if (!shape.holders && shape.handle < 0 && this.known.get(key) === shape) this.known.delete(key)
  }
}
