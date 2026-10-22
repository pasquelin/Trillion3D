import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { ceilDiv, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { DISPLACEMENT_WORDS } from '../../materials/table/displacementRecord.ts'
import { RASTER_PASSES } from '../raster/contract.ts'
import { MAX_GROUP_PATCHES, PASS_ARG_WORDS, PATCH_WORDS } from './contract.ts'
import type { TessellationValues } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'

/**
 * What the tessellation's kernels read of the view and of its settings, once an image
 * (`TessUni`): `edgesPerUnit`, the pixels a unit subtends at depth one per pixel an edge may span —
 * the cut's threshold —, `piecesPerEdge`, the pixels an edge may span over the dicing rate,
 * `edgesPerPixel`, the reciprocal of the threshold, `patchesPerGroup` the patches a group of the
 * dicing pass takes, and the capacities of the splitting queue and of the visible list. Each pass
 * has a uniform of its own, which says where its regions lie: `args`, `queue` and `visible` are
 * word offsets in the `tess` buffer (`tessLayout`), `dispatch` one in the `dispatch` buffer, and
 * `dispBase` where the displaced surfaces' records start in it (`displacementOf`). The
 * occlusion test of the patches (`splitWgsl.ts`): `occlusion` says which pyramid it reads
 * (`OCCLUSION_*`), `depthMap` the projection's clip depth, `prevViewProj`, `prevDepthMap` and
 * `prevSize` the previous image's view for the main pass, `maxOccluded` the patches the pass may keep
 * and `mainArgs` where the main pass's state lies, the post pass's source of those it kept.
 */
export const TESS_UNIFORM = fieldLayout('TessUni', [
  ['edgesPerUnit', 'f32'],
  ['piecesPerEdge', 'f32'],
  ['edgesPerPixel', 'f32'],
  ['patchesPerGroup', 'u32'],
  ['maxCandidate', 'u32'],
  ['maxVisible', 'u32'],
  ['args', 'u32'],
  ['queue', 'u32'],
  ['visible', 'u32'],
  ['dispatch', 'u32'],
  ['occlusion', 'u32'],
  ['maxOccluded', 'u32'],
  ['mainArgs', 'u32'],
  ['dispBase', 'u32'],
  ['depthMap', 'vec2f'],
  ['prevDepthMap', 'vec2f'],
  ['prevSize', 'vec2u'],
  ['prevViewProj', 'mat4x4f'],
] as const)
/** Bytes of the uniform, rounded to a vec4 as every uniform is. */
export const TESS_UNIFORM_BYTES = ceilDiv(TESS_UNIFORM.words, 4) * 16

/** What a view gives the uniform: its projection's vertical scale and the pixels it draws,
 *  and the cut's threshold in pixels an edge may span, above zero. */
export type TessellationView = { projection: number; height: number; threshold: number }

/** The settings the uniform takes. */
export type TessellationSettings = Pick<
  TessellationValues,
  'tessellationDicingRate' | 'tessellationMaxPatchesPerGroup'
>

/** Where a pass's regions start: in the `tess` buffer, its state, the queue, its visible list and the
 *  displaced surfaces' records, and in the `dispatch` buffer, its dispatches. */
type TessellationRegions = {
  args: number
  queue: number
  visible: number
  dispatch: number
  disp: number
}

/** What a pass's occlusion test reads (`TessUni`): `mode`, none, the previous image's pyramid or this
 *  image's (`OCCLUSION_MAIN`, `OCCLUSION_POST`), the matrices and depth maps of the views and the
 *  capacity of the buffer that keeps what it hid. */
export type TessellationSight = {
  mode: number
  prevViewProj: ArrayLike<number>
  depthMap: ArrayLike<number>
  prevDepthMap: ArrayLike<number>
  prevSize: ArrayLike<number>
  maxOccluded: number
  mainArgs: number
}

/** The patches the splitting queue and a visible list hold, as the device lets the buffer be, and the
 *  words the displaced surfaces' records have room for (`recordRoom`). */
export type TessellationCapacity = { candidate: number; visible: number; records: number }

/**
 * The words of the uniform for `view`, `settings`, `capacity`, `regions` and `sight`, written into `into`
 * (`TESS_UNIFORM.words` long, views of one buffer): `edgesPerUnit` is the view's pixels per unit at depth
 * one over the threshold, `piecesPerEdge` the threshold over the dicing rate. The patches a group takes
 * are the setting held to what a group's threads hold.
 */
export function writeTessellationUniform(
  floats: Float32Array,
  ints: Uint32Array,
  view: TessellationView,
  settings: TessellationSettings,
  capacity: TessellationCapacity,
  regions: TessellationRegions,
  sight: TessellationSight,
) {
  const at = TESS_UNIFORM.at
  const threshold = view.threshold > 0 ? view.threshold : 1
  floats[at.edgesPerUnit] = (0.5 * view.projection * view.height) / threshold
  floats[at.piecesPerEdge] = threshold / settings.tessellationDicingRate
  floats[at.edgesPerPixel] = 1 / threshold
  ints[at.patchesPerGroup] = Math.min(settings.tessellationMaxPatchesPerGroup, MAX_GROUP_PATCHES)
  ints[at.maxCandidate] = capacity.candidate
  ints[at.maxVisible] = capacity.visible
  ints[at.args] = regions.args
  ints[at.queue] = regions.queue
  ints[at.visible] = regions.visible
  ints[at.dispatch] = regions.dispatch
  ints[at.dispBase] = regions.disp
  ints[at.occlusion] = sight.mode
  ints[at.maxOccluded] = sight.maxOccluded
  ints[at.mainArgs] = sight.mainArgs
  floats.set(sight.prevViewProj, at.prevViewProj)
  floats.set(sight.depthMap, at.depthMap)
  floats.set(sight.prevDepthMap, at.prevDepthMap)
  ints.set(sight.prevSize, at.prevSize)
}

/** The chains the tessellation runs, each with a state of its own in the `tess` buffer: the passes of
 *  the cut, then the shadow maps' (`TESS_CHAIN_SHADOW`). */
export const TESS_CHAIN_SHADOW = RASTER_PASSES.length
export const TESS_CHAINS = RASTER_PASSES.length + 1

/** The words the records of the displaced surfaces take in the `tess` buffer when `words` of them are
 *  held: the least power of two that holds them, at least sixteen records, so that growth is rare. */
export const recordRoom = (words: number) =>
  Math.max(16 * DISPLACEMENT_WORDS, nextPow2(Math.max(1, words)))

/**
 * The words of the `tess` buffer, in order: the table (its offsets, then its vertices and
 * triangles), the displaced surfaces' records (`recordWords` of them), each chain's state, the
 * splitting queue every chain shares, then each pass's visible list. `tableWords` is the table's,
 * `maxCandidate` and `maxVisible` the capacities of the queue and of a visible list, in patches.
 * The shadow maps' chain keeps its patches in the first pass's list: the cut's passes have dealt
 * with theirs by the time the shadows are drawn, and a chain never reads what another wrote.
 */
export function tessLayout(
  tableWords: number,
  recordWords: number,
  maxCandidate: number,
  maxVisible: number,
) {
  const disp = tableWords
  const states = disp + recordWords
  const args = Array.from({ length: TESS_CHAINS }, (_, chain) => states + chain * PASS_ARG_WORDS)
  const queue = states + TESS_CHAINS * PASS_ARG_WORDS
  const first = queue + maxCandidate * PATCH_WORDS
  const visible = RASTER_PASSES.map((pass) => first + pass * maxVisible * PATCH_WORDS)
  visible[TESS_CHAIN_SHADOW] = visible[0]!
  return {
    disp,
    args,
    queue,
    visible,
    words: first + RASTER_PASSES.length * maxVisible * PATCH_WORDS,
  }
}

/**
 * The capacities the `tess` buffer holds on a device that binds `limitBytes` of a storage buffer at
 * most: the settings' where the whole fits, else both brought down in proportion, a patch short of
 * it. The words past the capacity are never written (`queuePatch`) and what they would have held is
 * counted lost.
 */
export function fitCapacity(
  limitBytes: number,
  tableWords: number,
  asked: TessellationCapacity,
): TessellationCapacity {
  const fixed = (tableWords + asked.records + TESS_CHAINS * PASS_ARG_WORDS) * 4
  const patches = asked.candidate + RASTER_PASSES.length * asked.visible
  const room = Math.floor((limitBytes - fixed) / (PATCH_WORDS * 4))
  if (patches <= room) return asked
  const share = Math.max(room, RASTER_PASSES.length + 1) / patches
  return {
    candidate: Math.max(1, Math.floor(asked.candidate * share)),
    visible: Math.max(1, Math.floor(asked.visible * share)),
    records: asked.records,
  }
}
