import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What the primed pyramid holds between its building and the cut that tests against it. */
export type PrimeBuilt = {
  /** The image it was built for (`WebgpuRunState.frame`). */
  frame: number
  /** The pyramid's texture view and the copy of the levels uniform it was built with. */
  view: GPUTextureView
  levels: GPUBuffer
  /** The size it was drawn at, which a box is tested in (`SelectionUniforms.prevSize`). */
  size: [number, number]
}

/** The primed pyramid each runtime built for its image, apart from the primed view's own state
 *  (`primeState.ts`) so that what reads it — the cut's occlusion, the tessellation's patches — reaches
 *  it without the passes that build it. */
const built = new WeakMap<WebgpuPagesRuntime, PrimeBuilt>()

/** The runtime built `pyramid` for its image, none when it built nothing. */
export const notePrimeBuilt = (rt: WebgpuPagesRuntime, pyramid: PrimeBuilt | undefined) =>
  void (pyramid ? built.set(rt, pyramid) : built.delete(rt))

/** The primed pyramid built for this image, none when the image primed nothing. */
export function builtPrime(rt: WebgpuPagesRuntime): PrimeBuilt | undefined {
  const held = built.get(rt)
  return held?.frame === rt.run.frame ? held : undefined
}
