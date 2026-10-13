/**
 * The one table of the deferred pass's bindings: the layout (`setup.ts`), the bind-group entries
 * (`program.ts`) and the WGSL declarations read their number here, so the opaque resolve, the blend
 * and the water composite, which extend the same list, read a surface lit on the same numbers. The
 * receiver's reads follow `receiver`; 15 to 17, 20 and 24 to 28 are the receiver's and the shadow
 * read's own, 30 and 31 the resolve proofs'.
 */
export const DEFERRED_BINDINGS = {
  baseMetal: 0,
  normalRough: 1,
  emissiveAo: 2,
  flags: 3,
  depth: 4,
  view: 5,
  lights: 6,
  tiles: 7,
  pageTable: 8,
  projectionData: 9,
  uniforms: 10,
  bounceGrid: 11,
  probes: 12,
  /** The translucent casters' transmission: the old shadow requests' number, free since the VSM. */
  transmissionResolve: 14,
  transmittance: 18,
  pool: 19,
  subsurface: 22,
  receiver: 23,
  /** The shadow mask's tile words (`vsmMaskFactor`), past the receiver's. */
  maskTiles: 29,
  lobes: 32,
  reflection: 33,
  /** What the water composite's fragments trace their shadow with (`CONTRACT_TRACE_BINDINGS`): the
   *  shadow projection's view uniform and its blue noise. */
  shadowView: 34,
  shadowNoise: 35,
} as const
