/**
 * The engine's one release: what a resource holds is given back by `dispose`, and each hook a
 * renderer's own copy of it listens with runs once, then is forgotten. Every resource the engine
 * copies — a geometry, an instanced mesh's matrices, a surface of the engine's own graph — is
 * released through it.
 */

/** Runs each hook of `released` once and forgets them all. */
export function release(released: Set<() => void>) {
  for (const hook of released) hook()
  released.clear()
}

/** Releases what a resource holds; each hook runs once, when it is given back. */
export class Releasable {
  /** Called when the resource is given back: what the engine's own copy of it listens to. */
  readonly released = new Set<() => void>()
  /** Gives the resource back. */
  dispose() {
    release(this.released)
  }
}
