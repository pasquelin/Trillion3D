/**
 * How the reflections' scene rays ended, each ray of the scene stage counted once: no distance field to march
 * (`noField`); the march met a surface and the surface cache gave its light (`hit`); the march met nothing and the
 * ray left the scene to the environment (`open`); the screen's far trace answered what left it (`distant`); the ray went
 * nowhere — the march met a surface none of the cards near it gave any light of, or nothing before the surface the screen
 * met — and the probes' field answers it (`miss`); the screen's surface was closer than the march can tell, no march made
 * (`bound`).
 */
export interface ReflectionSceneEnded {
  noField: number
  hit: number
  open: number
  miss: number
  bound: number
  distant: number
}

/**
 * What the reflections' rays did in one image, counted on the GPU by the trace and read back a few
 * images late (`ShadowFrameMetrics.reflections`): the counts are those of the image `censusFrame`,
 * both surfaces (the opaque one and the transparents' front one) together, and `null` before the first
 * reading and always where the project does not count (`reflectionStatistics`, off by default). A ray is a grid texel of a block of pixels (one at the default level, 2 × 2 at `high`) whose picked pixel traces.
 */
export interface ReflectionFrameMetrics {
  /** Censuses that came back, since the view's reflections were made. */
  censusReads: number | null
  /** The image the last census counted. */
  censusFrame: number | null
  /** Rays cast. */
  rays: number | null
  /** Of them: answered whole by the screen (it met a surface it trusts), nothing left for the scene stage. */
  screenRays: number | null
  /** Of them: left to the scene stage, whose rays end as `sceneEnded` counts. */
  sceneRays: number | null
  sceneEnded: ReflectionSceneEnded | null
  /** The steps the marches through the global distance field took, each ray's once (those that marched: not
   *  `noField`, not `bound`): under 8, 16, 32, 64, 128, 256, 512, 1 024, 2 048, 4 096, 8 192, more. */
  sceneWork: number[] | null
}
