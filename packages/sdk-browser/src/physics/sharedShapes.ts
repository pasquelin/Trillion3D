import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import type { BodyLedger } from './bodyLedger.ts'
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
  /** What keeps it restored — the bodies built on it, and who keeps it for them —; and the
   *  placements and openings naming it, which keep its read. */
  users: number
  holders: number
  /** Its read in flight, and the abort its last holder leaving lets it go by. */
  read: Promise<Uint8Array> | null
  abort: AbortController | null
  /** A soft body's settings: their bytes, kept while held. */
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
  ledger: Pick<BodyLedger, 'room' | 'claim' | 'give'>
  failed: (error: EngineError) => void
}

/**
 * The cooked objects a session's bodies are built from, one per kind and object however many
 * models, placements or bodies name it, while one holds it: read once, a failed read reported
 * once; a shape restored once as its bytes land if they fit, claimed then in the ledger, under a
 * handle of the session's ids (`createSimulatedIds`: a handle taken again is another), and
 * released by `settle` once no user keeps it or nothing holds it — never before, and never twice.
 */
export class SharedShapes {
  /** The collision bytes the restored shapes claim. */
  bytes = 0
  private readonly known = new Map<string, SharedShape>()
  private readonly handles = createSimulatedIds<SharedShape>()
  /** Restored shapes whose users fell to zero, or none came yet, `bares` of them: `settle`
   *  reads them. */
  private readonly bare: SharedShape[] = []
  private bares = 0
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
        kind,
        url,
        bytes,
        handle: -1,
        users: 0,
        holders: 0,
        read: null,
        abort: null,
        landed: null,
        refused: false,
        listed: false,
        ...extra,
      }
      this.known.set(`${kind} ${url}`, shape)
    }
    shape.holders += holders
    return shape as SharedShape & E
  }
  /** A holder of `shape` gone: the last one lets its read and its bytes go, and the shape be
   *  forgotten, refused or not, once released. */
  letGo(shape: SharedShape) {
    if (--shape.holders) return
    shape.abort?.abort()
    shape.read = shape.abort = shape.landed = null
    if (shape.handle >= 0) this.list(shape)
    this.forget(shape)
  }
  /** `shape`'s object, read once for every caller (`readShared`), in `tries` requests. */
  read(shape: SharedShape, tries?: number) {
    return shape.landed
      ? Promise.resolve(shape.landed)
      : readShared(shape, this.parts.failed, tries)
  }
  /**
   * Whether `shape` is restored, read first when it is not — in `tries` requests — and restored
   * as its bytes land if it is still held, `wanted`, and fits the share: false when it is not —
   * past the share, it waits, no failure —, when its read failed, or its restore, reported once
   * here.
   */
  async restored<S extends SharedShape>(shape: S, wanted?: (shape: S) => boolean, tries?: number) {
    if (shape.handle >= 0) return true
    const bytes = await this.read(shape, tries).catch(() => null)
    const fits = this.parts.ledger.room('collisionBytes') >= shape.bytes
    if (!bytes || shape.handle >= 0 || !shape.holders || !fits || (wanted && !wanted(shape)))
      return shape.handle >= 0
    try {
      this.restore(shape, bytes)
    } catch (error) {
      this.parts.failed(error as EngineError)
    }
    return shape.handle >= 0
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
    for (let i = 0; i < this.bares; i++) {
      bare[i].listed = false
      if (!bare[i].users || !bare[i].holders) this.release(bare[i])
    }
    this.bares = 0
    // Nothing held any more: the list lets go of the shapes it named.
    if (!this.known.size) bare.length = 0
  }
  /** Restores `shape` from its object's `bytes`, claimed in the ledger. */
  private restore(shape: SharedShape, bytes: Uint8Array) {
    this.parts.ledger.claim(shape, shape.bytes)
    this.bytes += shape.bytes
    shape.handle = this.handles.take(shape)
    this.parts.writer.restore(shape.handle, bytes)
    this.list(shape)
  }
  /** `shape` listed for `settle`, once. */
  private list(shape: SharedShape) {
    if (shape.listed) return
    shape.listed = true
    this.bare[this.bares++] = shape
  }
  private release(shape: SharedShape) {
    if (shape.handle < 0) return
    this.parts.writer.release(shape.handle)
    this.handles.release(shape.handle)
    this.parts.ledger.give(shape)
    this.bytes -= shape.bytes
    shape.handle = -1
    this.forget(shape)
  }
  /** `shape` out of the registry once nothing holds it and it is not restored. */
  private forget(shape: SharedShape) {
    const key = `${shape.kind} ${shape.url}`
    if (!shape.holders && shape.handle < 0 && this.known.get(key) === shape) this.known.delete(key)
  }
}
