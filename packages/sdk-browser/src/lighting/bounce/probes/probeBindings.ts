import { BOUNCE_LIGHT_LIST_BINDING } from '../lightCellWgsl.ts'

/** The proxy in the probe pass (`probes.ts`): its buffer, the culling's records — the worlds it is
 *  placed by and its instances — and the placement tree its rays walk. */
export const PROBE_PROXY = { group: 0, proxy: 1, worlds: 7, tree: 8 } as const

/** The probe pass's bindings (`BOUNCE_PROBE_SHADER`), the one table its WGSL and its layout read:
 *  the cascades' uniform, the proxy, the lights, the queue, the frozen probes and the output — the
 *  atlases of `../atlas.ts` —, the world grid's light lists (`BOUNCE_LIGHT_LIST_BINDING`), the
 *  culling's worlds the proxy is placed by and its placement tree (`PROBE_PROXY`) and the census the
 *  update adds its counts to (`censusWgsl.ts`) and the light functions' atlas (`PROBE_LIGHT_FUNCTION`). */
export const PROBE_BINDINGS = {
  grid: 0,
  proxy: PROBE_PROXY.proxy,
  lights: 2,
  queue: 3,
  snapshot: 4,
  probes: 5,
  lists: BOUNCE_LIGHT_LIST_BINDING,
  worlds: PROBE_PROXY.worlds,
  tree: PROBE_PROXY.tree,
  census: 9,
  lightFunction: 10,
  skyCube: 11,
  skySampler: 12,
  skyHarmonics: 13,
  skyParams: 14,
  cloudShadowBlock: 15,
  cloudShadowMap0: 16,
  cloudShadowMap1: 17,
  cloudShadowSampler: 18,
} as const

/** Where the probe pass reads the clouds' shade of the lights (\`cloudShadowReadWgsl\`). */
export const PROBE_CLOUD_SHADOW = {
  group: 0,
  block: PROBE_BINDINGS.cloudShadowBlock,
  map0: PROBE_BINDINGS.cloudShadowMap0,
  map1: PROBE_BINDINGS.cloudShadowMap1,
  sampler: PROBE_BINDINGS.cloudShadowSampler,
} as const

/** Where the probe pass reads the sky light (\`skyLightReadWgsl\`): the cubes its rays that leave the scene
 *  reach the sky by, and the harmonics' uniform. */
export const PROBE_SKY_LIGHT = {
  group: 0,
  cube: PROBE_BINDINGS.skyCube,
  sampler: PROBE_BINDINGS.skySampler,
  harmonics: PROBE_BINDINGS.skyHarmonics,
  params: PROBE_BINDINGS.skyParams,
} as const

/** Where the probe pass reads the light functions (`lightFunctionReadWgsl`): their atlas, and the eye their fade is
 *  measured from, the cascades' uniform holding it (`BOUNCE_GRID`). */
export const PROBE_LIGHT_FUNCTION = {
  group: 0,
  atlas: PROBE_BINDINGS.lightFunction,
  eye: 'bounce.eye.xyz',
} as const

/** The snapshot's follow-up's bindings (`BOUNCE_SNAPSHOT_SHADER`), read by its WGSL and its layout:
 *  the cascades' uniform, the queue, the probes it reads and the snapshot it writes. */
export const SNAPSHOT_BINDINGS = { grid: 0, queue: 1, probes: 2, snapshot: 3 } as const

/** The table write's bindings (`BOUNCE_TABLE_SHADER`): its records, and the probes' atlas and its
 *  snapshot, both written. */
export const TABLE_BINDINGS = { records: 0, probes: 1, snapshot: 2 } as const

/** The mark pass's bindings (`BOUNCE_MARK_SHADER`): the levels' uniform and the atlas they read, the
 *  view's uniform, the image's depth and normals, and the bitmap the cells marked go to. */
export const MARK_BINDINGS = {
  grid: 0,
  probes: 1,
  view: 2,
  depth: 3,
  normals: 4,
  marks: 5,
} as const

/** The field census's bindings (`BOUNCE_CENSUS_SHADER`): the levels' uniform, the probes' atlas it
 *  counts, and the census. */
export const CENSUS_BINDINGS = { grid: 0, probes: 1, census: 2 } as const
