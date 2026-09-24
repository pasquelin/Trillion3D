/**
 * What every resource of the engine's own graph shares: an identity a reader keys it on, and the
 * release a renderer's copy of it follows.
 */
/** Numbers a resource by kind, for the identity a reader keys it on. */
let nextResource = 1;
export const identity = (kind: string) => `${kind}-${nextResource++}`;

/** Releases what a resource holds; each hook runs once, when it is given back. */
export class Releasable {
  /** Called when the resource is given back: what a renderer's own copy of it listens to. */
  readonly released = new Set<() => void>();
  /** Gives the resource back. */
  dispose() {
    for (const hook of this.released) hook();
    this.released.clear();
  }
}
