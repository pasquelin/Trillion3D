import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { globalDistanceFieldTraceWgsl } from '../../distanceField/globalTraceWgsl.ts'
import {
  surfaceHitCardsLayoutEntries,
  surfaceHitLayoutEntries,
  surfaceHitWgsl,
  type SurfaceHitBindings,
} from '../../surfaceCache/hitWgsl.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { sceneMaskedLayoutEntries } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceLayoutEntries } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { VISUALIZE_MODE } from '../../surfaceCache/visualizeModes.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { BLUE_NOISE_FORMAT } from '../../../gpu/noise/blueNoiseTextures.ts'
import { FRONT_TRACED_FORMAT } from '../frontLayer.ts'
import {
  REFLECTION_DEPTH_FORMAT,
  REFLECTION_GRID_FORMAT,
  REFLECTION_HISTORY_FORMAT,
  REFLECTION_RAY_FORMAT,
} from '../grids.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { lightFunctionLayoutEntry } from '../../lightFunction/bindings.ts'
import { lightProfileLayoutEntries } from '../../lightProfile/profileBindings.ts'
import { rayFogLayoutEntries, type RayFogBindings } from '../rayFog.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'

/** The surface a kernel's pipeline works on — 0 the opaque, 1 the transparents' front
 *  (`../frontLayer.ts`) —, given by the pipeline (`createTraceStages`): one entry a kernel, two
 *  pipelines, the same specialisation two entries made. The override is declared with the reflection's
 *  view (`reflectionBindingsWgsl`), which reads it for the block and the flags of each layer. */
export const REFLECTION_LAYER_WGSL = wgslBlock('REFLECTION_LAYER_WGSL', [], '')

/**
 * THE ONE TABLE OF THE REFLECTIONS' GROUP 0, shared by the classification, the trace, the resolve, the
 * temporal accumulation and the last pass (`trace.ts`): the WGSL declarations, the layouts and the
 * entries read their numbers here. A group serves one surface — the opaque one or the transparents'
 * front one (`../frontLayer.ts`) — and one parity of the history's turn about (`traceGroups.ts`): its
 * flags, normals and lobes (its depth is the reflection group's), the blocks' rays (`rays`: the depth of the
 * pixel each texel casts from and the ray the ray generation draws), what a ray reads of the
 * scene — the lights, the bounce levels' uniform, the global distance field its scene stage marches
 * (`field`: six bindings) and the surface cache its hits read (`cards`: the tables, the atlas's seven layers and the
 * feedback buffer; `grid`, the field's object grid; `instances`, the table from an object of the grid to its
 * placement in the cache) —, the
 * textures each kernel reads or writes (`../grids.ts`: the fresh grid the
 * trace writes, `traceOut`, and the resolve reads, `freshIn`; the resolved pixels the resolve writes,
 * `resolvedOut`, and the accumulation reads, `temporalIn`; the history the
 * accumulation reads, `historyIn`, and writes, `historyOut`, the last pass reads, `bilateralIn`; and the
 * surfaces' vectors the velocity stage drew, `vectors`, by which the accumulation carries the history of a surface
 * that moves by itself and a screen hit finds where it stood in the last image; the depth the last image kept, `depthHistory`,
 * which a screen hit is told from a surface the last image did not show there by, and the kernel that keeps this image's, `depthKeep`), the
 * lists the classification fills (`../tiles.ts`: `tracingOut`, `clearTracingOut`, `resolveOut`,
 * `clearOut` as it fills them, `tiles` as a kernel runs over one), and the rays the screen stage missed
 * (`pendingOut`, `pendingIn`), which the scene stage runs over and the meshes' fields stage (`pendingMesh`, the same list, bound to write the answers it gives) runs over before it; the blue noise the ray generation draws a ray's direction from (`blue`, read as a
 * read-only storage texture: no sampled texture of the stage's sixteen spent on it); the counters both ray stages add to (`census`, `../censusWgsl.ts`). The scene stage alone reads the fog's own cubemap and the sampler it is read through (`fogCubemap`, `fogSampler`), which tint the height fog laid over a ray.
 * The opaque last pass writes the reflection target the resolve reads, the front one the radiance the
 * forward fragments read.
 */
export const REFLECTION_TRACE_BINDINGS = {
  flags: 0,
  // Not 1: the cut's tables the scene trace reads sit at the culling's bindings, 1, 6, 7 and 9 (`hardwareHitLayout`).
  normals: 58,
  lobes: 2,
  lights: 3,
  traceOut: 10,
  rays: 11,
  freshIn: 12,
  resolvedOut: 14,
  temporalIn: 15,
  historyIn: 16,
  historyOut: 17,
  bilateralIn: 18,
  target: 20,
  frontTarget: 21,
  tiles: 22,
  pendingOut: 25,
  pendingIn: 26,
  tracingOut: 31,
  resolveOut: 32,
  raysRead: 33,
  clearTracingOut: 34,
  clearOut: 35,
  depthHistory: 36,
  depthKeep: 37,
  census: 38,
  field: 39,
  cards: 45,
  grid: 54,
  instances: 55,
  vectors: 56,
  blue: 57,
  fogCubemap: 59,
  fogSampler: 60,
  pendingMesh: 61,
  hits: 62,
  // The hit lighting's lists (`hitLighting/`): the compacted traces and their count, the sorted ones, the radiance of the first pass.
  litList: 63,
  litSorted: 64,
  litRadiance: 65,
  // What the first pass reads of the lights beside the lights' buffer: the light functions' atlas (read as a storage texture, spending none of the stage's sampled textures) and the light profiles' atlas with its sampler.
  litFunction: 66,
  litProfile: 67,
  litProfileSampler: 68,
  // The light grid the first pass culls its lights with (`../../rays/lightGrid/`), a read-only storage texture.
  litGrid: 69,
} as const

const B = REFLECTION_TRACE_BINDINGS

/** Where the scene stage reads the fog's own cubemap and sampler (`fogCubemap`, `fogSampler`). */
export const REFLECTION_FOG_BINDINGS: RayFogBindings = {
  cubemap: B.fogCubemap,
  sampler: B.fogSampler,
}

/** The global distance field the scene stage marches its rays through, and the march (`gdfTrace`): the field's
 *  six bindings (`globalDistanceFieldReadWgsl`) from `field` on, in group 0. */
export const REFLECTION_FIELD_WGSL = globalDistanceFieldTraceWgsl(0, B.field)

/** Where the scene stage's hits read the surface cache (`../../surfaceCache/hitWgsl.ts`): the field's six bindings, the cache's from
 *  `cards` on, its feedback buffer written, the field's object grid and the table of instances. */
export const REFLECTION_HIT_BINDINGS: SurfaceHitBindings = {
  group: 0,
  field: B.field,
  grid: B.grid,
  cards: B.cards,
  instances: B.instances,
  feedback: true,
}

/** Where the hit lighting's finishing pass reads the surface cache: the same bindings, the indirect light's layer in place of the final one (`hitLighting/`). */
export const REFLECTION_INDIRECT_BINDINGS: SurfaceHitBindings = {
  ...REFLECTION_HIT_BINDINGS,
  visualize: VISUALIZE_MODE.indirectLighting,
}

/** The hit's read the scene stage's rays end in (`scGlobalHit`), over the group's bindings, the cache's final light stored in `light`. */
export const reflectionSurfaceHitWgsl = (light: LightAtlasFormat) =>
  surfaceHitWgsl(REFLECTION_HIT_BINDINGS, light)

/** The surface every kernel reads — its flags, normals and lobes. */
const pixels = () => [
  computeTextureEntry(B.flags, 'uint'),
  computeTextureEntry(B.normals, 'unfilterable-float'),
  computeTextureEntry(B.lobes, 'uint'),
]

/** The grid's rays, an array of `REFLECTION_RAY_LAYERS` layers (the picked pixel's depth, the direction, the cone angle):
 *  written as storage by the ray generation and the clear of the unused tracing tiles, read as storage by the
 *  stages that trace them, read sampled by every kernel after them (`raysRead`) — never both in one group. */
const rays = () =>
  computeStorageTextureEntry(B.rays, REFLECTION_RAY_FORMAT, 'read-write', '2d-array')
const raysRead = () => computeTextureEntry(B.raysRead, 'uint', '2d-array')

/** The surface every kernel after the classification reads, its rays (`words`: sampled but in
 *  the kernels that trace them, which read them as storage), and the tiles it runs over — all but the scene stage, which
 *  runs over the rays the screen missed (`tiles` false). */
const surface = (words = raysRead(), tiles = true) => [
  ...pixels(),
  words,
  ...(tiles ? [computeBufferEntry(B.tiles, 'read-only-storage')] : []),
]

/** The blue noise a ray's direction is drawn from (`blueNoiseVec2`): the ray generation's. */
const noise = () => computeStorageTextureEntry(B.blue, BLUE_NOISE_FORMAT, 'read-only')

/** Where a screen hit stood in the last image and what that image kept there: the surfaces' vectors of this image (`vectors`) and the depth
 *  the last image kept (`depthHistory`, `REFLECTION_DEPTH_FORMAT`). Both ray stages read them, the screen's for its hits and the scene's for
 *  the lit image a hit may take. */
const past = (stored = false) => [
  computeTextureEntry(B.vectors, 'uint'),
  // The depth is only ever loaded at a texel, so the scene stage through the scene's triangles (`stored`) reads it as a read-only storage
  // texture: with the fog's cubemap its stage holds sixteen sampled textures, WebGPU's limit per stage, and a seventeenth is refused,
  // while it holds three of the four storage textures a stage may (`REFLECTION_DEPTH_FORMAT` is one of the formats a storage texture reads).
  stored
    ? computeStorageTextureEntry(B.depthHistory, REFLECTION_DEPTH_FORMAT, 'read-only')
    : computeTextureEntry(B.depthHistory, 'unfilterable-float'),
]

/** The lights, whose buffer holds the sky a ray that leaves the scene sees (`reflectionEnvironment`): what answers
 *  a lobe that casts no ray (the screen stage, the last pass) and the rest of a ray (the scene stage). */
const field = () => [computeBufferEntry(B.lights, 'read-only-storage')]

/** The fog's own cubemap and the sampler it is read through (`reflectionFogged`): the colour the height fog lays over what a ray brings back,
 *  tinted by the cubemap where the fog has one and the sky light does not light it. The scene stage's alone, the only one that fogs a ray. */
const fog = () => rayFogLayoutEntries(REFLECTION_FOG_BINDINGS, true)

/** What a ray reads of the scene here — the field with the lights, and what a hit reads (`REFLECTION_HIT_BINDINGS`): the global
 *  distance field the ray is marched through with its object grid, the surface cache its hit is read in, less the layers a hit
 *  does not read, and the table from an object of the grid to its placement. The scene stage's alone. */
const scene = (light: LightAtlasFormat) => [
  ...field(),
  ...fog(),
  ...surfaceHitLayoutEntries(REFLECTION_HIT_BINDINGS, light),
]

/** The classification's layout: the pixels and the four lists it fills. */
const classifyLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [
      ...pixels(),
      computeBufferEntry(B.tracingOut, 'storage'),
      computeBufferEntry(B.clearTracingOut, 'storage'),
      computeBufferEntry(B.resolveOut, 'storage'),
      computeBufferEntry(B.clearOut, 'storage'),
    ],
  })

type LayoutOf = (
  entries: GPUBindGroupLayoutEntry[],
  words?: GPUBindGroupLayoutEntry,
  tiles?: boolean,
) => GPUBindGroupLayout

const storageEntry = (binding: number) =>
  computeStorageTextureEntry(binding, REFLECTION_GRID_FORMAT)
const sampledEntry = (binding: number) => computeTextureEntry(binding, 'uint')

/** The layouts of the ray stages: the generation, the screen stage, the clearing of unused tiles and the scene stage. */
function rayLayouts(layout: LayoutOf, statistics: boolean, light: LightAtlasFormat) {
  const census = statistics ? [computeBufferEntry(B.census, 'storage')] : []
  return {
    // The lights are read for the lobes the pixel's ray is drawn from (`lobesAt`, a cloth's sheen).
    generate: layout([...field(), noise()], rays()),
    screen: layout(
      [
        ...field(),
        ...past(),
        storageEntry(B.traceOut),
        computeBufferEntry(B.pendingOut, 'storage'),
        ...census,
      ],
      rays(),
    ),
    clearTracing: layout([], rays()),
    // The rays are read as the storage they are written through: no sampled texture of the stage's sixteen is spent on them,
    // the hit's reads of the cache needing them.
    scene: layout(
      [
        ...scene(light),
        ...past(),
        ...census,
        storageEntry(B.traceOut),
        computeBufferEntry(B.pendingIn, 'read-only-storage'),
      ],
      rays(),
      false,
    ),
    // The meshes' fields stage (`meshes.ts`) over the rays the screen missed: the first compaction reads their list (it is the dispatch's indirect arguments: read alone) and the rays; the trace reads what a hit reads, the fog and the lights, writes the fresh grid and the list.
    meshCompact: layout([computeBufferEntry(B.pendingMesh, 'read-only-storage')], rays(), false),
    meshTrace: layout(
      [...scene(light), storageEntry(B.traceOut), computeBufferEntry(B.pendingMesh, 'storage')],
      rays(),
      false,
    ),
  }
}

/** The layouts of the resolve, the temporal accumulation and each surface's last pass and clear. */
function answerLayouts(layout: LayoutOf) {
  // What the opaque surface's answer writes past the field and its lights: the reflection target; the front one's: the radiance the
  // forward fragments read.
  const opaque = [computeStorageTextureEntry(B.target, HDR_FORMAT, 'write-only', '2d-array')]
  const front = [computeStorageTextureEntry(B.frontTarget, FRONT_TRACED_FORMAT)]
  // The last pass reads the history; the clear empties it and the resolved pixels.
  const last = [sampledEntry(B.bilateralIn)]
  const history = computeStorageTextureEntry(B.historyOut, REFLECTION_HISTORY_FORMAT)
  const clear = [storageEntry(B.resolvedOut), history]
  return {
    // The resolve decodes the pixel's lobes, a cloth's sheen read from the lights' tables (`setClothLobes`).
    resolve: layout([...field(), sampledEntry(B.freshIn), storageEntry(B.resolvedOut)]),
    temporal: layout([
      sampledEntry(B.temporalIn),
      sampledEntry(B.historyIn),
      sampledEntry(B.vectors),
      history,
    ]),
    bilateral: layout([...field(), ...opaque, ...last]),
    bilateralFront: layout([...field(), ...front, ...last]),
    clear: layout([...field(), ...opaque, ...clear]),
    clearFront: layout([...field(), ...front, ...clear]),
  }
}

/** The layouts of each kernel's group 0: the classification, the ray generation, the trace's two stages and the clear of
 *  its unused tiles, the resolve, the temporal accumulation, and each surface's last pass and clear,
 *  each writing its surface's answer. The two ray stages bind the census's buffer where the project
 *  counts (`statistics`, `reflectionStatistics`). The surface cache's final light is read in the format `light`. */
export const traceLayouts = (
  device: GPUDevice,
  statistics: boolean,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => {
  const layout: LayoutOf = (entries, words, tiles) =>
    device.createBindGroupLayout({ entries: [...surface(words, tiles), ...entries] })
  return {
    classify: classifyLayout(device),
    keepDepth: device.createBindGroupLayout({
      entries: [computeStorageTextureEntry(B.depthKeep, REFLECTION_DEPTH_FORMAT)],
    }),
    ...rayLayouts(layout, statistics, light),
    ...answerLayouts(layout),
  }
}

/** The tiles a kernel runs over (`../tiles.ts`): the list the classification wrote — its head, the
 *  dispatch's arguments and the count, then a tile a word, x in the low half, y in the high, in tiles
 *  of `REFLECTION_SIDE`² texels for the grid's kernels, of pixels for the pixels' —;
 *  `reflectionTileOf`, the tile of a workgroup of a dispatch of `groups`, `REFLECTION_NO_TILE` past the
 *  count: the whole workgroup returns at once, a value the same for all its threads; and the first
 *  texel or pixel of a tile, `reflectionTileOrigin`. */
export const REFLECTION_TILES_WGSL = wgslBlock(
  'REFLECTION_TILES_WGSL',
  [listWgsl({ name: 'reflectionTiles', group: 0, binding: B.tiles, entry: 'u32', append: false })],
  `const REFLECTION_NO_TILE:u32=0xffffffffu;
fn reflectionTileOf(wg:vec3u,groups:vec3u)->u32{
 let at=flatIndex(wg,groups,1u);
 if(at>=reflectionTiles.count){return REFLECTION_NO_TILE;}
 return reflectionTiles.entries[at];
}
fn reflectionTileOrigin(t:u32)->vec2u{return vec2u(t&0xffffu,t>>16u)*${REFLECTION_SIDE}u;}`,
)

/** The scene trace's group and its first binding in it, in the scene stage that casts its rays through the scene's triangles
 *  (`../sceneTraceHardware.ts`). */
export const REFLECTION_HARDWARE_SCENE = { group: 2, first: 0 } as const

/** The layout of group 0 of the scene stage that casts its rays through the scene's triangles, once a device: the scene stage's less the
 *  global field and its object grid (the rays are not marched) nor the cut's tables (the trace kept the triangles, `hardwareHitLayout`),
 *  with what a hit reads of the surface cache. */
const hardwareSceneLayoutOf = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
  hardwareAnswerLayout(device, light, REFLECTION_HIT_BINDINGS, [
    computeBufferEntry(B.pendingIn, 'read-only-storage'),
    computeBufferEntry(B.hits, 'storage'),
  ]),
)

/** The layout of the answer over the cards bindings `cards` (the final light, or the indirect light of the hit lighting's finishing pass) with the buffers `extra` past the hits. */
export const hardwareAnswerLayout = (
  device: GPUDevice,
  light: LightAtlasFormat,
  cards: SurfaceHitBindings,
  extra: GPUBindGroupLayoutEntry[],
) =>
  device.createBindGroupLayout({
    label: 'Trillion3D reflection scene trace',
    entries: [
      ...surface(rays(), false),
      ...field(),
      ...fog(),
      ...past(true),
      ...surfaceHitCardsLayoutEntries(cards, light),
      computeStorageTextureEntry(B.traceOut, REFLECTION_GRID_FORMAT),
      // The triangles the trace kept (`hardwareHitLayout`), which this answer reads, then what else the pass reads.
      ...extra,
    ],
  })

/** The layout of group 0 of the scene stage that casts its rays through the scene's triangles, once a device and a format of the cache's final light. */
export const hardwareSceneLayout = (
  device: GPUDevice,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => hardwareSceneLayoutOf(device, light)

/** The layout of the scene trace's own group (`REFLECTION_HARDWARE_SCENE`) in the answer, once a device: the trace's resources alone, the answer casting no ray (`stParams` only), the stage's group 0 and the reflection group holding sixteen sampled textures already. */
export const hardwareTraceLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D reflection scene trace triangles',
    entries: sceneTraceLayoutEntries(REFLECTION_HARDWARE_SCENE.first),
  }),
)

/** The layout of group 0 of the trace that casts the scene stage's rays through the scene's triangles (`hardwareReflectionKernels`, the kernel `traceSceneHit`), once a device: the surface's pixels and its rays, the lights, the cut's tables, the list of
 *  the rays the screen missed and the buffer the triangles they meet are kept in. It holds neither the cache nor the fog's cubemap, so that the any-hit test's colour atlas fits beside the cut's tables in the stage's sixteen sampled textures. */
export const hardwareHitLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D reflection scene trace hits',
    entries: [
      ...surface(rays(), false),
      ...field(),
      ...dagReadLayoutEntries(),
      computeBufferEntry(B.pendingIn, 'read-only-storage'),
      computeBufferEntry(B.hits, 'storage'),
    ],
  }),
)

/** The layout of group 0 of the hit lighting's first pass (`litDirect`): the trace's (`hardwareHitLayout`) less the list of the rays missed (the pass runs over the list of the traces to light, which it adds, with its sorted copy and the radiance it writes): eight storage buffers with the scene trace's three, then the light functions' atlas and the light profiles' (`litFunction`, `litProfile`). The sixteenth sampled texture of the stage is the profiles' atlas: the pass binds the reflection group without the lit image (`reflectionHitLayout`). */
export const hardwareLitLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D reflection hit lighting direct',
    entries: [
      ...surface(rays(), false),
      ...field(),
      ...dagReadLayoutEntries(),
      computeBufferEntry(B.hits, 'storage'),
      computeBufferEntry(B.litList, 'read-only-storage'),
      computeBufferEntry(B.litSorted, 'read-only-storage'),
      computeBufferEntry(B.litRadiance, 'storage'),
      lightFunctionLayoutEntry(B.litFunction, undefined, true),
      ...lightProfileLayoutEntries({ atlas: B.litProfile, sampler: B.litProfileSampler }),
      computeStorageTextureEntry(B.litGrid, 'r32uint', 'read-only'),
    ],
  }),
)

/** The layout of group 0 of the hit lighting's second pass (`litFinish`): the answer's, over the indirect light of the cache, less the list of the rays missed, with the hits, the lists and the first pass's radiance read: eight storage buffers, the scene trace's group (`hardwareFinishSceneLayout`) holding none. */
export const hardwareFinishLayout = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
  hardwareAnswerLayout(device, light, REFLECTION_INDIRECT_BINDINGS, [
    computeBufferEntry(B.hits, 'storage'),
    computeBufferEntry(B.litList, 'read-only-storage'),
    computeBufferEntry(B.litSorted, 'read-only-storage'),
    computeBufferEntry(B.litRadiance, 'read-only-storage'),
  ]),
)

/** The layout of the scene trace's own group (`REFLECTION_HARDWARE_SCENE`) in the trace of the rays (`hardwareHitLayout`): the trace and its any-hit test (`sceneMaskWgsl.ts`). */
export const hardwareMaskedTraceLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D reflection scene trace triangles masked',
    entries: sceneMaskedLayoutEntries(REFLECTION_HARDWARE_SCENE.first),
  }),
)

/** The layout of the scene trace's own group (`REFLECTION_HARDWARE_SCENE`) in the hit lighting's second pass, once a device: the trace's parameters alone, the pass casting no ray (its group 0 holds eight storage buffers already). */
export const hardwareFinishSceneLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D reflection hit lighting finish scene',
    entries: [computeUniformEntry(REFLECTION_HARDWARE_SCENE.first)],
  }),
)
