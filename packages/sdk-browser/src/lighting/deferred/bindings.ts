/**
 * The one table of the deferred pass's bindings: the layout (`setup.ts`), the bind-group entries
 * (`program.ts`) and the WGSL declarations read their number here, so the opaque resolve and the
 * blend, which extend the same list, read a surface lit on the same numbers; 30 and 31 are the resolve
 * proofs'. The surfaces are read through two bindings of their layered targets and one of the emission
 * (`SurfaceBuffer`): `colours`, the colour layers (the base and metalness, then the normal and roughness),
 * and `words`, the word layers (the flags, then the shadow receiver's two), each a layer of one texture —
 * three sampled textures of the sixteen a stage holds in place of five.
 */
export const DEFERRED_BINDINGS = {
  colours: 0,
  emissiveAo: 2,
  words: 3,
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
  /** What the light functions are read from (`DEFERRED_LIGHT_FUNCTION_BINDINGS`): the atlas and its
   *  table, a texture of words read by load — the contract programs'. */
  lightFunctionAtlas: 43,
  /** The light shafts' occlusion mask the fog's inscattering is multiplied by
   *  (`../../modules/sky/lightShafts/frame.ts`), a sampled texture read through `fogSampler`: the
   *  contract programs'. */
  fogLightShaft: 44,
  /** The sky light's cubes, their sampler, harmonics and the view's uniform (`DEFERRED_SKY_LIGHT_BINDINGS`). */
  skyCube: 45,
  skySampler: 46,
  skyHarmonics: 47,
  skyParams: 48,
  /** The clouds' shade: the block of matrices and strengths, the two maps and the sampler
   *  (`DEFERRED_CLOUD_SHADOW_BINDINGS`). */
  cloudShadowBlock: 49,
  cloudShadowMap0: 50,
  cloudShadowMap1: 51,
  cloudShadowSampler: 52,
} as const

/** Where the contract programs bind the sky light's resources, in group 0 (`skyLightReadWgsl`). */
export const DEFERRED_SKY_LIGHT_BINDINGS = {
  group: 0,
  cube: DEFERRED_BINDINGS.skyCube,
  sampler: DEFERRED_BINDINGS.skySampler,
  harmonics: DEFERRED_BINDINGS.skyHarmonics,
  params: DEFERRED_BINDINGS.skyParams,
} as const

/** Where the contract programs bind the clouds' shade, in group 0 (`cloudShadowReadWgsl`). */
export const DEFERRED_CLOUD_SHADOW_BINDINGS = {
  group: 0,
  block: DEFERRED_BINDINGS.cloudShadowBlock,
  map0: DEFERRED_BINDINGS.cloudShadowMap0,
  map1: DEFERRED_BINDINGS.cloudShadowMap1,
  sampler: DEFERRED_BINDINGS.cloudShadowSampler,
} as const

/** Where the contract programs bind the light functions' resources, and the eye their fade is
 *  measured from (`lightFunctionReadWgsl`). */
export const DEFERRED_LIGHT_FUNCTION_BINDINGS = {
  group: 0,
  atlas: DEFERRED_BINDINGS.lightFunctionAtlas,
  eye: 'view.display.yzw',
} as const

/** Where the contract programs bind the fog's resources, in group 0 (`fogResourcesWgsl`). */
export const DEFERRED_FOG_BINDINGS = {
  group: 0,
  sampler: DEFERRED_BINDINGS.fogSampler,
  cubemap: DEFERRED_BINDINGS.fogCubemap,
  volume: DEFERRED_BINDINGS.fogVolume,
  lightShaft: DEFERRED_BINDINGS.fogLightShaft,
} as const
