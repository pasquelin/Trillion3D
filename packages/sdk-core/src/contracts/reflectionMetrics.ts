/**
 * How the reflections' proxy rays ended, each ray of the scene stage counted once: no proxy to walk;
 * the walk spent by its units (`work`), its triangle tests (`tests`), its steps of the placement tree
 * (`tree`) or a mesh's walk (`mesh`) — the ray then answers nothing —; a surface hit (`hit`); the
 * ray left the scene to the environment (`open`); the ray went nowhere and the field answers it
 * (`miss`); the screen's surface was closer than the proxy can tell, no walk made (`bound`).
 */
export interface ReflectionProxyEnded {
  noProxy: number
  work: number
  tests: number
  tree: number
  mesh: number
  hit: number
  open: number
  miss: number
  bound: number
}

/**
 * What the reflections' rays did in one image, counted on the GPU by the trace and read back a few
 * images late (`ShadowFrameMetrics.reflections`): the counts are those of the image `censusFrame`,
 * both surfaces (the opaque one and the transparents' front one) together, and `null` before the first
 * reading. A ray is a grid texel of a 2 × 2 block of pixels whose picked pixel traces.
 */
export interface ReflectionFrameMetrics {
  /** The units and the triangle tests a proxy ray may spend: the budget its walk is spent against. */
  proxyUnits: number
  proxyTriangles: number
  /** Censuses that came back, since the view's reflections were made. */
  censusReads: number | null
  /** The image the last census counted. */
  censusFrame: number | null
  /** Rays cast. */
  rays: number | null
  /** Of them: past the near field, where the field answers all the screen left and no proxy is walked. */
  farRays: number | null
  /** Of them: met by the screen in part or whole (a surface it trusts). */
  screenRays: number | null
  /** Of the rays in the near field: answered whole by the screen, nothing left for the scene stage. */
  screenWholeRays: number | null
  /** Of them: left to the scene stage, whose walks end as `proxyEnded` counts. */
  sceneRays: number | null
  proxyEnded: ReflectionProxyEnded | null
  /** The units the walks of the proxy spent, each walk once (those with a walk: not `noProxy`, not
   *  `bound`): under 8, 16, 32, 64, 128, 256, 512, more. */
  proxyWork: number[] | null
}
