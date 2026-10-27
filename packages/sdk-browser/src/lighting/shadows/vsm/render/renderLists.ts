/**
 * THE RASTER'S LISTS (`renderPass.ts`): their sizes for a frame, the bytes their growth asks of the
 * device ledger, and their growth — the engine's one rule (`sizedBuffer`).
 */
import { grownLength } from '../../../../../../math/src/sequence/resized.ts'
import { sizedBuffer } from '../../../../gpu/core/sizedBuffer.ts'
import { madeTextureBytes, textureBytesOf } from '../../../../gpu/core/textureBytes.ts'
import type { UniformSlots } from '../../../../session/memory/pools.ts'
import {
  VSM_RENDER_CANDIDATE_BYTES,
  VSM_RENDER_LIGHT_BYTES,
  VSM_RENDER_RECORD_BYTES,
} from '../constants.ts'
import {
  VSM_RENDER_ARGS_WORDS,
  VSM_RENDER_SOFTWARE_VIEW_RECORDS,
  vsmCountWords,
} from './renderParamsWgsl.ts'
import { renderTarget, type VsmRenderContext } from './renderPipes.ts'

/** The lists the raster holds, by name: the view passes' parameters, the views the GPU lists, the
 *  frame's lights, the candidates, the counters, the records the cull emits and the same sorted by
 *  tier (`renderBinWgsl.ts`), the indirect arguments. */
export type VsmListName =
  'params' | 'views' | 'lights' | 'candidates' | 'counts' | 'records' | 'sorted' | 'args'

/** Bytes of each list, by name. */
export type VsmListSizes = Record<VsmListName, number>

/** Bytes a list holds at least: a binding is never empty. */
const LIST_FLOOR = 256

/** The records the sorted list holds past the record list's capacity: the software counts' word and,
 *  where the views of the maps are laid in it (`laid`: `vsmViewsLaid`), the views of `maps` maps a
 *  view pass holds at most (`VSM_RENDER_SOFTWARE_VIEWS_WGSL`). */
export const vsmSortedExtraRecords = (maps: number, laid: boolean) =>
  1 + (laid ? VSM_RENDER_SOFTWARE_VIEW_RECORDS * maps : 0)

/** The sizes of the lists of a frame of `passes` view passes, of at most `mostMaps` maps each, for
 *  `lights` lights, `casters` candidates and `records` records a pass, the parameters' slots
 *  `slots` apart, the counters followed by `feedbackWords` words of the compute throttle's counts
 *  (`vsmFeedbackWords`, none by default): rewritten in place in `into`. `laid`: the sorted list holds
 *  the views of the maps too. */
export function vsmListSizes(
  into: VsmListSizes,
  slots: UniformSlots,
  passes: number,
  mostMaps: number,
  lights: number,
  casters: number,
  records: number,
  feedbackWords = 0,
  laid = false,
) {
  into.params = passes * slots.stride
  // A group a light and a view a map, four words a view.
  into.views = 4 * (lights + mostMaps) * 4
  into.lights = lights * VSM_RENDER_LIGHT_BYTES
  into.candidates = casters * VSM_RENDER_CANDIDATE_BYTES
  into.counts = vsmCountWords(feedbackWords) * 4
  into.records = records * VSM_RENDER_RECORD_BYTES
  into.sorted = (records + vsmSortedExtraRecords(mostMaps, laid)) * VSM_RENDER_RECORD_BYTES
  into.args = VSM_RENDER_ARGS_WORDS * 4
  return into
}

/** Bytes the device is asked for when `buffers` grow to `sizes` (`sizedBuffer`): each one short of
 *  its size made anew, whole, while the one it held still lives — retired after the frame's submit. */
export function vsmListGrowth(
  buffers: Partial<Record<string, GPUBuffer>>,
  sizes: Record<string, number>,
) {
  let total = 0
  for (const name in sizes) {
    const held = buffers[name]?.size ?? 0,
      size = Math.max(sizes[name], LIST_FLOOR)
    if (held < size) total += grownLength(held, size)
  }
  return total
}

/** The records the held list of `ctx` holds: what a frame keeps when the room refuses its growth. */
export const heldRecords = (ctx: Pick<VsmRenderContext, 'buffers'>) =>
  Math.floor((ctx.buffers.records?.size ?? 0) / VSM_RENDER_RECORD_BYTES)

/** Usage of the lists the kernels fill: the counters are copied out. */
export const STORAGE = () =>
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
const STORAGE_LISTS: readonly VsmListName[] = [
  'views',
  'lights',
  'candidates',
  'counts',
  'records',
  'sorted',
]

/** The lists of `ctx` under `label`, grown to `sizes`: the context's own buffers, every one made,
 *  returned. A frame allocates nothing past them. */
export function vsmEnsureLists(ctx: VsmRenderContext, label: string, sizes: VsmListSizes) {
  const ensure = (name: VsmListName, usage: GPUBufferUsageFlags) => {
    const bytes = Math.max(sizes[name], LIST_FLOOR)
    ctx.buffers[name] = sizedBuffer(ctx.device, ctx.buffers[name], bytes, usage, `${label}.${name}`)
  }
  ensure('params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  for (const name of STORAGE_LISTS) ensure(name, STORAGE())
  ensure('args', STORAGE() | GPUBufferUsage.INDIRECT)
  return ctx.buffers as Record<VsmListName, GPUBuffer>
}

/** Bytes the raster's context of a set holds on the device: its lists and its dummy target. */
export function vsmContextBytes(ctx: VsmRenderContext | undefined) {
  if (!ctx) return 0
  let bytes = madeTextureBytes(ctx.targetTexture)
  for (const buffer of Object.values(ctx.buffers)) bytes += buffer?.size ?? 0
  return bytes
}

/** The least bytes the raster's context takes beside a new set (`vsmGrant.ts`): its dummy target and
 *  its lists for `casters` candidates and `records` records, the room then always holding one view
 *  pass's lists. */
export function vsmRenderFloorBytes(
  slots: UniformSlots,
  passes: number,
  mostMaps: number,
  lights: number,
  casters: number,
  records: number,
  laid: boolean,
) {
  if (casters <= 0 || lights + mostMaps <= 0) return 0
  const sizes = vsmListSizes(
    {} as VsmListSizes,
    slots,
    passes,
    mostMaps,
    lights,
    casters,
    records,
    0,
    laid,
  )
  return textureBytesOf(renderTarget())! + vsmListGrowth({}, sizes)
}
