/**
 * What every resource of the engine's own graph shares: the release the engine's copy of it
 * follows.
 */
/** Releases what a resource holds; each hook runs once, when it is given back. */
export class Releasable {
  /** Called when the resource is given back: what the engine's own copy of it listens to. */
  readonly released = new Set<() => void>()
  /** Gives the resource back. */
  dispose() {
    for (const hook of this.released) hook()
    this.released.clear()
  }
}
