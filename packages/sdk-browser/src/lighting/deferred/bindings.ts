/**
 * The one table of the deferred pass's bindings: the layout (`setup.ts`), the bind-group entries
 * (`program.ts`) and the WGSL declarations read their number here, so the opaque resolve and the
 * blend, which extend the same list, read a surface lit on the same numbers. The receiver target
 * is `receiver`; 30 and 31 are the resolve proofs'.
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
  bounceGrid: 11,
  probes: 12,
  /** The mask's transmission, what the panes let through along each light's missed rays: the
   *  opaque resolve's (`vsmMaskThrough`). */
  transmissionResolve: 14,
  transmittance: 18,
  subsurface: 22,
  receiver: 23,
  /** The shadow mask's tile words (`vsmMaskFactor`): the opaque resolve's. */
  maskTiles: 29,
  lobes: 32,
  reflection: 33,
  /** What the screen probes left of the pixels' indirect light (`../bounce/screen/indirectWgsl.ts`): the
   *  bounce program's, a sampled texture read by load. */
  screenIndirect: 34,
  /** The screen-space ambient occlusion the image drew (`../ao/frame.ts`): the opaque resolve's, a sampled
   *  texture of one byte a pixel read by load, a stand-in where the image drew none. */
  ambientOcclusion: 35,
  /** What the fog reads past the light buffer (`DEFERRED_FOG_BINDINGS`): the sampler its cubemap and
   *  volume are read through, the cubemap and the volume — the contract programs'. */
  fogSampler: 40,
  fogCubemap: 41,
  fogVolume: 42,
} as const

/** Where the contract programs bind the fog's resources, in group 0 (`fogResourcesWgsl`). */
export const DEFERRED_FOG_BINDINGS = {
  group: 0,
  sampler: DEFERRED_BINDINGS.fogSampler,
  cubemap: DEFERRED_BINDINGS.fogCubemap,
  volume: DEFERRED_BINDINGS.fogVolume,
} as const
