import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { globalDistanceFieldTraceWgsl } from '../../distanceField/globalTraceWgsl.ts'
import {
  surfaceHitLayoutEntries,
  surfaceHitWgsl,
  type SurfaceHitBindings,
} from '../../surfaceCache/hitWgsl.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { FRONT_TRACED_FORMAT } from '../frontLayer.ts'
import {
  REFLECTION_GRID_FORMAT,
  REFLECTION_HISTORY_FORMAT,
  REFLECTION_RAY_FORMAT,
} from '../grids.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { REFLECTION_SIDE } from '../constants.ts'
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
 * flags, normals and lobes (its depth is the reflection group's), the blocks' ray words (`rays`: the
 * traced pixel the classification picks, the ray the screen stage casts), what a ray reads of the
 * scene — the lights, the bounce levels' uniform, the global distance field its scene stage marches
 * (`field`: six bindings) and the surface cache its hits read (`cards`: the tables, the atlas's seven layers and the
 * feedback buffer; `grid`, the field's object grid; `instances`, the table from an object of the grid to its
 * placement in the cache) —, the
 * textures each kernel reads or writes (`../grids.ts`: the fresh grid the
 * trace writes, `traceOut`, and the resolve reads, `freshIn`; the resolved pixels the resolve writes,
 * `resolvedOut`, and the accumulation reads, `temporalIn`; the history the
 * accumulation reads, `historyIn`, and writes, `historyOut`, the last pass reads, `bilateralIn`; and the
 * surfaces' vectors the velocity stage drew, `vectors`, by which the accumulation carries the history of a surface
 * that moves by itself), the
 * lists the classification fills (`../tiles.ts`: `tracingOut`, `clearTracingOut`, `resolveOut`,
 * `clearOut` as it fills them, `tiles` as a kernel runs over one), and the rays the screen stage left
 * (`pendingOut`, `pendingIn`) with their partial answers (`partialOut`, `partialIn`), which the scene
 * stage runs over; the depth and pdf of each ray, which the screen stage writes beside it (`rayDataOut`) and
 * the resolve reads (`rayDataIn`); the counters both ray stages add to (`census`, `../censusWgsl.ts`).
 * The opaque last pass writes the reflection target the resolve reads, the front one the radiance the
 * forward fragments read.
 */
export const REFLECTION_TRACE_BINDINGS = {
  flags: 0,
  normals: 1,
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
  base: 19,
  target: 20,
  frontTarget: 21,
  tiles: 22,
  partialOut: 23,
  partialIn: 24,
  pendingOut: 25,
  pendingIn: 26,
  tracingOut: 31,
  resolveOut: 32,
  raysRead: 33,
  clearTracingOut: 34,
  clearOut: 35,
  rayDataOut: 36,
  rayDataIn: 37,
  census: 38,
  field: 39,
  cards: 45,
  grid: 54,
  instances: 55,
  vectors: 56,
} as const

const B = REFLECTION_TRACE_BINDINGS

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

/** The hit's read the scene stage's rays end in (`scGlobalHit`), over the group's bindings. */
export const REFLECTION_SURFACE_HIT_WGSL = surfaceHitWgsl(REFLECTION_HIT_BINDINGS)

/** The surface every kernel reads — its flags, normals and lobes. */
const pixels = () => [
  computeTextureEntry(B.flags, 'uint'),
  computeTextureEntry(B.normals, 'unfilterable-float'),
  computeTextureEntry(B.lobes, 'uint'),
]

/** The grid's ray words (`rayPack`): the blocks' pixels the classification picks and the rays the
 *  screen stage casts beside them, written as storage by those two, read sampled by every kernel
 *  after them (`raysRead`) — never both in one group. */
const rays = () => computeStorageTextureEntry(B.rays, REFLECTION_RAY_FORMAT, 'read-write')
const raysRead = () => computeTextureEntry(B.raysRead, 'uint')

/** The surface every kernel after the classification reads, its ray words (`words`: sampled but in
 *  the screen stage, which writes them), and the tiles it runs over — all but the scene stage, which
 *  runs over the rays the screen left (`tiles` false). */
const surface = (words = raysRead(), tiles = true) => [
  ...pixels(),
  words,
  ...(tiles ? [computeBufferEntry(B.tiles, 'read-only-storage')] : []),
]

/** The lights, whose buffer holds the sky a ray that leaves the scene sees (`reflectionEnvironment`): what answers
 *  a lobe that casts no ray (the screen stage, the last pass) and the rest of a ray (the scene stage). */
const field = () => [computeBufferEntry(B.lights, 'read-only-storage')]

/** What a ray reads of the scene here — the field with the lights, and what a hit reads (`REFLECTION_HIT_BINDINGS`): the global
 *  distance field the ray is marched through with its object grid, the surface cache its hit is read in, less the layers a hit
 *  does not read, and the table from an object of the grid to its placement. The scene stage's alone. */
const scene = () => [...field(), ...surfaceHitLayoutEntries(REFLECTION_HIT_BINDINGS)]

/** The classification's layout: the pixels, the ray words it picks them into and the four lists it fills. */
const classifyLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [
      ...pixels(),
      rays(),
      computeBufferEntry(B.tracingOut, 'storage'),
      computeBufferEntry(B.clearTracingOut, 'storage'),
      computeBufferEntry(B.resolveOut, 'storage'),
      computeBufferEntry(B.clearOut, 'storage'),
    ],
  })

/** The layouts of each kernel's group 0: the classification, the trace's two stages and the clear of
 *  its unused tiles, the resolve, the temporal accumulation, and each surface's last pass and clear,
 *  each writing its surface's answer. The two ray stages bind the census's buffer where the project
 *  counts (`statistics`, `reflectionStatistics`). */
export const traceLayouts = (device: GPUDevice, statistics: boolean) => {
  const census = statistics ? [computeBufferEntry(B.census, 'storage')] : []
  const layout = (
    entries: GPUBindGroupLayoutEntry[],
    words?: GPUBindGroupLayoutEntry,
    tiles?: boolean,
  ) => device.createBindGroupLayout({ entries: [...surface(words, tiles), ...entries] })
  const storage = (binding: number) => computeStorageTextureEntry(binding, REFLECTION_GRID_FORMAT)
  const sampled = (binding: number) => computeTextureEntry(binding, 'uint')
  // What the opaque surface's answer reads and writes past the field and its lights: its base colour,
  // the reflection target; the front one's: the radiance the forward fragments read.
  const opaque = [
    computeTextureEntry(B.base, 'unfilterable-float'),
    computeStorageTextureEntry(B.target, HDR_FORMAT, 'write-only', '2d-array'),
  ]
  const front = [computeStorageTextureEntry(B.frontTarget, FRONT_TRACED_FORMAT)]
  // The last pass reads the history; the clear empties it and the resolved pixels.
  const last = [sampled(B.bilateralIn)]
  const history = computeStorageTextureEntry(B.historyOut, REFLECTION_HISTORY_FORMAT)
  const clear = [storage(B.resolvedOut), history]
  return {
    classify: classifyLayout(device),
    screen: layout(
      [
        ...field(),
        storage(B.traceOut),
        storage(B.partialOut),
        storage(B.rayDataOut),
        computeBufferEntry(B.pendingOut, 'storage'),
        ...census,
      ],
      rays(),
    ),
    clearTracing: layout([], rays()),
    // The ray words are read as the storage they are written through, and the partial answers as read-only storage: no
    // sampled texture of the stage's sixteen is spent on either, the hit's reads of the cache needing them.
    scene: layout(
      [
        ...scene(),
        ...census,
        storage(B.traceOut),
        computeStorageTextureEntry(B.partialIn, REFLECTION_GRID_FORMAT, 'read-only'),
        computeBufferEntry(B.pendingIn, 'read-only-storage'),
      ],
      rays(),
      false,
    ),
    resolve: layout([sampled(B.freshIn), sampled(B.rayDataIn), storage(B.resolvedOut)]),
    temporal: layout([sampled(B.temporalIn), sampled(B.historyIn), sampled(B.vectors), history]),
    bilateral: layout([...field(), ...opaque, ...last]),
    bilateralFront: layout([...field(), ...front, ...last]),
    clear: layout([...field(), ...opaque, ...clear]),
    clearFront: layout([...field(), ...front, ...clear]),
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
