/**
 * The one table of the deferred pass's bindings: the layout (`setup.ts`), the bind-group entries
 * (`program.ts`) and the WGSL declarations read their number here, so the opaque lit passes and the
 * blend, which extend the same list, read a surface lit on the same numbers; 30 and 31 are the resolve
 * proofs'. The surfaces are read through two bindings of their layered targets and one of the emission
 * (`SurfaceBuffer`): `colours`, the colour layers (the base and metalness, then the normal and roughness),
 * and `words`, the word layers (the flags), each a layer of one texture —
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
  /** The virtual shadow maps' local lights' mask, a texel a pixel (`vsmLocalFactor`): the opaque lit passes'. */
  vsmMask: 18,
  subsurface: 22,
  /** The suns' mask, a layer a sun (`vsmSunFactor`): a read-only storage texture, for the lit pass has no
   *  sampled texture to spare; the opaque lit passes'. */
  vsmSunMask: 29,
  lobes: 32,
  reflection: 33,
  /** What the screen probes left of the pixels' indirect light (`../bounce/screen/indirectWgsl.ts`): the
   *  bounce program's, a sampled texture read by load. */
  screenIndirect: 34,
  /** The screen-space ambient occlusion the image drew (`../ao/frame.ts`): the opaque lit passes', a sampled
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
  /** The lists of the local fog volumes over each tile of the view (`DEFERRED_FOG_BINDINGS`,
   *  `fogTilesWgsl`, `../fog/localWgsl.ts`): the contract programs', a read-only storage buffer of words. */
  fogLocalTiles: 54,
  /** The sky light's distance-field occlusion (`../distanceField/ao/`): the image of bent normals and depths packed in a
   *  read-only storage buffer — the lit pass has no sampled texture to spare —, and the uniform that describes it
   *  (`dfaoReadWgsl`): the opaque lit passes', stand-ins where the image drew none. */
  dfaoBent: 55,
  dfaoRead: 56,
  /** The tile lists of the classification (`tileClass.ts`): a read-only storage buffer of words the
   *  tile passes' vertex stage reads, a tile a word, a list a class. */
  tileList: 57,
  /** The ranks of the directional lights in the light buffer (`DirectLights.items`), after their
   *  count: what the sun pass walks in place of a cell's list (`frame/backend/state/lightBuffer.ts`). */
  sunRanks: 58,
  /** The volume of the haze the fog pass lays over the surfaces (`../atmosphere/hazeReadWgsl.ts`),
   *  a 3D texture read through `fogSampler`. */
  hazeVolume: 60,
  /** The light the volumetric lightmap gives each pixel (`volumetricLightWgsl.ts`): the irradiance of its third-order
   *  harmonics along the pixel's normal, a texture of the lighting that the indirect pass reads by load,
   *  a stand-in where the image drew none. */
  volumetricLight: 61,
  /** The virtual shadow maps a light with no lane in the mask is read from, one sample of its own map
   *  (`vsmSampleMapLocal`): the uniforms, the page table, the projection data and the pool's first
   *  slice, and the projection's view uniform — the opaque lit passes'. */
  vsmUniforms: 62,
  vsmPageTable: 63,
  vsmProjectionData: 64,
  vsmPool: 65,
  vsmView: 66,
  /** The shadowed lights of each cell of the light grid (`lightGridWgsl.ts`), the projection's: where the
   *  local lights' mask holds a light's lane (`vsmMaskLaneOf`) — the opaque lit passes'. */
  vsmLightGrid: 67,
  /** The mask of the shadowed local light a per-light draw lights (`shadowOnePassProjection` false,
   *  `perLightPassWgsl.ts`), a texel a pixel, and the light's record (`perLightRecord.ts`), a uniform
   *  read at a dynamic offset. */
  perLightMask: 68,
  perLightRecord: 69,
  /** The light profiles' atlas, a filterable 2D array of half floats, and its sampler
   *  (`DEFERRED_LIGHT_PROFILE_BINDINGS`): the contract programs' of a scene with a profiled light alone
   *  (`ContractKey.profileless`). */
  lightProfileAtlas: 70,
  lightProfileSampler: 71,
  /** The ambient cubemap's cube, its sampler and its colour and intensity (`ambientCubemapWgsl.ts`): the indirect pass's when the
   *  image sets one. */
  ambientCube: 72,
  ambientCubeSampler: 73,
  ambientCubeColour: 74,
  /** The scene without the water's linear depth (the clip w, the water pass's copy), which the fog behind the water reads in place of the
   *  device depth (`fogPassWgsl.ts`). */
  waterLinearDepth: 75,
  /** The screen-space contact shadows' array (`contactShadowMethod` 1, `contactBendWgsl`), a layer a marched light, 1 where lit: the passes of lights of a scene
   *  that holds contact shadow code, a one-texel stand-in where the image marched none. */
  contactBend: 77,
  /** The ranks of the lights that have a layer in that array, in the order of its layers (`contactBendWgsl`): a uniform of
   *  the same programs. */
  contactBendRanks: 78,
  /** The short-range global illumination the screen probes left of the pixels (`../bounce/screen/indirectWgsl.ts`): the bounce program's, a read-only storage texture of half floats read by load (the lit pass
   *  has no sampled texture to spare), a black stand-in where the probes gathered none. */
  screenShortRangeGi: 76,
  /** The screen probes' history of every closure a pixel holds, an array of words with a layer for each (`../bounce/screen/indirectWgsl.ts`, `SCREEN_INDIRECT_CLOSURES_WGSL`): the bounce program's of a view of several
   *  closures (`ContractKey.closures`), read by load; a one-layer stand-in where the probes gathered none. */
  screenIndirectClosures: 89,
  /** The short-range global illumination of every closure, the same: a sampled array of half floats, no fifth storage texture being bound. */
  screenShortRangeGiClosures: 90,
  /** The indirect capsule shadows' factors (`../capsuleShadows/host.ts`): a read-only storage buffer of bytes, one a pixel, 255 for light let through, read by load
   *  (`capsuleIndirectAt`); the indirect pass's of an image that casts them, a stand-in where it drew none. */
  capsuleIndirect: 79,
  /** The light the sampled lighting leaves for the local lights' pass to add (`../manyLightsSampled/spatialWgsl.ts`, `ContractKey.sampled`): a sampled texture read by load, a stand-in where the image made none. */
  sampledLight: 81,
  /** The shadows the heterogeneous volumes cast, one read-only storage buffer of words (`beerShadowMapPack.ts`): the opaque lit passes' of a
   *  scene whose volumes cast shadows (`ContractKey.volumeShadow`), a one-word stand-in where the image built none. */
  volumeShadow: 82,
  /** The rectangle lights' pictures (`DEFERRED_LIGHT_PROFILE_BINDINGS`): the atlas and its trilinear sampler, bound beside the light profiles' (`ContractKey.profileless`). */
  rectAtlas: 83,
  rectAtlasSampler: 84,
  /** The reflection captures' cube array, its sampler and the block of their records (`../reflectionCapture/compositeWgsl.ts`): the opaque indirect pass's when
   *  captures are made (`ContractKey.captureless`). */
  captureCube: 85,
  captureSampler: 86,
  captureBlock: 87,
  /** The toon buffer (`../toon/buffer.ts`): the profiles' rows, their baked patterns and the toon specular's peak table, one read-only storage buffer the lit passes that
   *  light toon pixels bind (`toonTablesBinding`), a few bytes of header where no material is toon. */
  toonTables: 88,
} as const

/** The toon data the pass after the lights reads, in its second group: the diffuse light and the weights (`toonMain`, `TOON_DATA_OUT_WGSL`). */
export const TOON_DATA_BINDINGS = { diffuse: 0, weights: 1 } as const

/** Where the passes that light toon pixels bind the toon buffer. */
export const DEFERRED_TOON_TABLES = { group: 0, binding: DEFERRED_BINDINGS.toonTables } as const

/** Where the programs that hold contact shadow code bind the screen-space shadows' array and the ranks of its layers (`contactBendWgsl`). */
export const DEFERRED_CONTACT_BEND_BINDINGS = {
  array: DEFERRED_BINDINGS.contactBend,
  ranks: DEFERRED_BINDINGS.contactBendRanks,
} as const

/** Where the indirect pass binds the reflection captures' resources, in group 0 (`reflectionCapturesWgsl`). */
export const DEFERRED_CAPTURE_BINDINGS = {
  group: 0,
  cube: DEFERRED_BINDINGS.captureCube,
  sampler: DEFERRED_BINDINGS.captureSampler,
  block: DEFERRED_BINDINGS.captureBlock,
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

/** Where the contract programs bind the light profiles' atlas and its sampler, in group 0 (`lightProfileMultiplierWgsl`). */
export const DEFERRED_LIGHT_PROFILE_BINDINGS = {
  group: 0,
  atlas: DEFERRED_BINDINGS.lightProfileAtlas,
  sampler: DEFERRED_BINDINGS.lightProfileSampler,
  rectAtlas: DEFERRED_BINDINGS.rectAtlas,
  rectSampler: DEFERRED_BINDINGS.rectAtlasSampler,
} as const

/** Where the contract programs bind the fog's resources, in group 0 (`fogResourcesWgsl`). */
export const DEFERRED_FOG_BINDINGS = {
  group: 0,
  sampler: DEFERRED_BINDINGS.fogSampler,
  cubemap: DEFERRED_BINDINGS.fogCubemap,
  volume: DEFERRED_BINDINGS.fogVolume,
  lightShaft: DEFERRED_BINDINGS.fogLightShaft,
  tiles: DEFERRED_BINDINGS.fogLocalTiles,
} as const
