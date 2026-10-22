import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { RASTER_PASSES } from '../raster/contract.ts'
import { MAX_GROUP_PATCHES, PASS_ARG_WORDS, PATCH_WORDS } from './contract.ts'
import type { TessellationValues } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'

/**
 * What the tessellation's kernels read of the view and of its settings, once an image
 * (`TessUni`): `lodScale`, the pixels a unit subtends at depth one per pixel an edge may span —
 * the cut's threshold —, `invDiceRate`, the pixels an edge may span over the dicing rate,
 * `edgesPerPixel`, the reciprocal of the threshold, `patchesPerGroup` the patches a group of the
 * dicing pass takes, and the capacities of the splitting queue and of the visible list. Each pass
 * has a uniform of its own, which says where its regions lie: `args`, `queue` and `visible` are
 * word offsets in the `tess` buffer (`tessLayout`), `dispatch` one in the `dispatch` buffer.
 */
export const TESS_UNIFORM = fieldLayout('TessUni', [
  ['lodScale', 'f32'],
  ['invDiceRate', 'f32'],
  ['edgesPerPixel', 'f32'],
  ['patchesPerGroup', 'u32'],
  ['maxCandidate', 'u32'],
  ['maxVisible', 'u32'],
  ['args', 'u32'],
  ['queue', 'u32'],
  ['visible', 'u32'],
  ['dispatch', 'u32'],
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

/** Where a pass's regions start: in the `tess` buffer, its state, the queue, its visible list, and
 *  in the `dispatch` buffer, its two dispatches. */
export type TessellationRegions = { args: number; queue: number; visible: number; dispatch: number }

/** The patches the splitting queue and a visible list hold, as the device lets the buffer be. */
export type TessellationCapacity = { candidate: number; visible: number }

/**
 * The words of the uniform for `view`, `settings`, `capacity` and `regions`, written into `into`
 * (`TESS_UNIFORM.words` long, views of one buffer): `lodScale` is the view's pixels per unit at depth
 * one over the threshold, `invDiceRate` the threshold over the dicing rate. The patches a group takes
 * are the setting held to what a group's threads hold.
 */
export function writeTessellationUniform(
  floats: Float32Array,
  ints: Uint32Array,
  view: TessellationView,
  settings: TessellationSettings,
  capacity: TessellationCapacity,
  regions: TessellationRegions,
) {
  const at = TESS_UNIFORM.at
  const threshold = view.threshold > 0 ? view.threshold : 1
  floats[at.lodScale] = (0.5 * view.projection * view.height) / threshold
  floats[at.invDiceRate] = threshold / settings.tessellationDicingRate
  floats[at.edgesPerPixel] = 1 / threshold
  ints[at.patchesPerGroup] = Math.min(settings.tessellationMaxPatchesPerGroup, MAX_GROUP_PATCHES)
  ints[at.maxCandidate] = capacity.candidate
  ints[at.maxVisible] = capacity.visible
  ints[at.args] = regions.args
  ints[at.queue] = regions.queue
  ints[at.visible] = regions.visible
  ints[at.dispatch] = regions.dispatch
}

/**
 * The words of the `tess` buffer, in order: the table (its offsets, then its vertices and
 * triangles), each pass's state, the splitting queue both passes share, then each pass's visible
 * list. `tableWords` is the table's, `maxCandidate` and `maxVisible` the capacities of the
 * queue and of a visible list, in patches.
 */
export function tessLayout(tableWords: number, maxCandidate: number, maxVisible: number) {
  const args = RASTER_PASSES.map((pass) => tableWords + pass * PASS_ARG_WORDS)
  const queue = tableWords + RASTER_PASSES.length * PASS_ARG_WORDS
  const first = queue + maxCandidate * PATCH_WORDS
  const visible = RASTER_PASSES.map((pass) => first + pass * maxVisible * PATCH_WORDS)
  return { args, queue, visible, words: first + RASTER_PASSES.length * maxVisible * PATCH_WORDS }
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
  const fixed = (tableWords + RASTER_PASSES.length * PASS_ARG_WORDS) * 4
  const patches = asked.candidate + RASTER_PASSES.length * asked.visible
  const room = Math.floor((limitBytes - fixed) / (PATCH_WORDS * 4))
  if (patches <= room) return asked
  const share = Math.max(room, RASTER_PASSES.length + 1) / patches
  return {
    candidate: Math.max(1, Math.floor(asked.candidate * share)),
    visible: Math.max(1, Math.floor(asked.visible * share)),
  }
}
