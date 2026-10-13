/**
 * THE ROWS' SHADOW CHANGES STALE THE PREVIOUS FRAME'S PAGES (`castInvalidationWgsl.ts`): the GPU
 * half of a move's invalidation, beside the CPU's boxes of what no row says — residency, geometry
 * rewritten in place, lights (`invalidationPass.ts`). The CPU sends the maps that may hold cached
 * pages, read before the plan gives this frame its ids (`vsmCastMaps`), never a box: the rows pass
 * appended them (`../webgpu/shadow/castChanges.ts`), and a one-thread kernel sizes the stale's
 * dispatch from their count. Once read, the list is emptied in the same command buffer.
 */
import { computeBufferEntry } from '../gpu/core/computeBindings.ts'
import type { CastChanges } from '../webgpu/shadow/castChanges.ts'
import { consumedCasts } from '../webgpu/shadow/castChanges.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import {
  CAST_ARGS_ENTRY,
  CAST_ARGS_WGSL,
  CAST_INVALIDATION_ENTRY,
  MAP_COVER,
  castInvalidationWgsl,
} from './castInvalidationWgsl.ts'
import { VSM_INVALIDATION_SPECS } from './invalidationWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { vsmComputePipe, type VsmComputePipe } from './passKit.ts'
import { vsmBufferGroup, vsmEnsureBuffer, vsmRenderStorage } from './renderPass.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmPerFrameSet,
  type VsmResources,
} from './resources.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'

/** The pass that stales the rows' changes, its two kernels in it. */
const CAST_LABEL = `${VSM_PASS_PREFIX}invalidateCastPages`

/** The maps that may hold cached pages, each a word (`MAP_ID`, `MAP_COVER`), ids the previous
 *  frame's: as the CPU's boxes filter them (`vsmInvalidationPhaseFromShadowBoxes`), less the range
 *  test, which the GPU makes per box. None when the cache holds nothing to stale. */
export function vsmCastMaps(cache: VsmCacheManager): Uint32Array | null {
  if (!cache.acceptsInvalidations()) return null
  const words: number[] = []
  for (const entry of cache.entries.values()) {
    if (!entry.mayHoldCachedPages()) continue
    for (let i = 0; i < entry.mapCaches.length; i++)
      words.push((entry.mapId + i) | (entry.useCover ? MAP_COVER : 0))
  }
  return words.length ? Uint32Array.from(words, (word) => word >>> 0) : null
}

/** The stale's kernel and the arguments' kernel for `layout`, made once a device and source. */
export function vsmCastPipes(device: GPUDevice, layout: VsmLayout) {
  const C = GPUShaderStage.COMPUTE
  const [uniform, read, write] = (['uniform', 'read-only-storage', 'storage'] as const).map(
    (type) => (binding: number) => computeBufferEntry(binding, type, C),
  )
  return {
    stale: vsmComputePipe(
      device,
      CAST_LABEL,
      castInvalidationWgsl(layout),
      CAST_INVALIDATION_ENTRY,
      [
        vsmBindGroupLayoutEntries(VSM_INVALIDATION_SPECS, layout, C),
        [uniform(0), read(1), read(2)],
      ],
    ),
    args: vsmComputePipe(device, CAST_LABEL, CAST_ARGS_WGSL, CAST_ARGS_ENTRY, [
      [uniform(0), read(1), write(2)],
    ]),
  }
}

/** What the stale holds for a set (`VsmInvalidationState.casts`): its kernels, its group over the
 *  set's tables, its buffers — the parameters, the maps, the indirect arguments — and its two other
 *  groups with the list they were made over, made again when a buffer they name moved. */
export interface VsmCastState {
  device: GPUDevice
  pipes: ReturnType<typeof vsmCastPipes>
  tables: VsmPerFrameSet<GPUBindGroup>
  params: GPUBuffer
  buffers: Partial<Record<'maps' | 'args', GPUBuffer>>
  groups?: { over: GPUBuffer[]; sizing: GPUBindGroup; stale: GPUBindGroup }
}

/** The arguments' group and the stale's own over `list`, the maps and the arguments: those held
 *  while each names the same buffers. */
function castGroups(state: VsmCastState, list: GPUBuffer, maps: GPUBuffer, args: GPUBuffer) {
  const over = [list, maps, args],
    held = state.groups
  if (held && held.over.every((buffer, k) => buffer === over[k])) return held
  const { device, pipes, params } = state
  return (state.groups = {
    over,
    sizing: vsmBufferGroup(device, pipes.args.groups[0], [params, list, args]),
    stale: vsmBufferGroup(device, pipes.stale.groups[1], [params, maps, list]),
  })
}

function castState(device: GPUDevice, res: VsmResources, held: { casts?: VsmCastState }) {
  return (held.casts ??= {
    device,
    pipes: vsmCastPipes(device, res.layout),
    tables: vsmFrameSetHeld(),
    params: device.createBuffer({
      label: 'vsm.castInvalidation.params',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    buffers: {},
  })
}

/** Group 0 of the stale over the tables of `res.current`. */
const tablesGroup = (res: VsmResources, state: VsmCastState) =>
  state.device.createBindGroup({
    layout: state.pipes.stale.groups[0],
    entries: vsmBindGroupEntries(res, VSM_INVALIDATION_SPECS),
  })

/** The parameters' words: the maps' count, then padding. */
const paramsImage = new Uint32Array(4)

/**
 * Stales the pages the rows' changes in `casts` touched in the previous frame's maps `maps`
 * (`vsmCastMaps`), into `encoder`, then empties the list; nothing when no light casts or no pass
 * appended to it since it was last read, nothing staled when the previous frame had no slot or no
 * map may hold cached pages, the list emptied all the same — no page holds what it names. Must run
 * where the CPU's boxes do, before the page carry (`encodeVsmInvalidations`).
 */
export function encodeCastInvalidation(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  held: { casts?: VsmCastState },
  frame: { device: GPUDevice; mapSlotCount: number; maps: Uint32Array | null; casts?: CastChanges },
) {
  const { device, mapSlotCount, maps, casts } = frame
  if (!casts?.appended) return
  if (mapSlotCount > 0 && maps) {
    const state = castState(device, res, held),
      label = 'vsm.castInvalidation',
      indirect = GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT
    const mapBuffer = vsmEnsureBuffer(
        state,
        label,
        'maps',
        maps.byteLength,
        vsmRenderStorage(),
        16,
      ),
      args = vsmEnsureBuffer(state, label, 'args', 16, indirect, 16),
      groups = castGroups(state, casts.buffer, mapBuffer, args)
    device.queue.writeBuffer(mapBuffer, 0, maps)
    paramsImage[0] = maps.length
    device.queue.writeBuffer(state.params, 0, paramsImage)
    const { stale, args: sizing } = state.pipes
    const pass = encoder.beginComputePass({ label: CAST_LABEL })
    pass.setPipeline(sizing.pipeline)
    pass.setBindGroup(0, groups.sizing)
    pass.dispatchWorkgroups(1)
    pass.setPipeline(stale.pipeline)
    pass.setBindGroup(0, vsmPerFrameSet(state.tables, res, tablesGroup, state))
    pass.setBindGroup(1, groups.stale)
    pass.dispatchWorkgroupsIndirect(args, 0)
    pass.end()
  }
  consumedCasts(casts, encoder)
}

/** Frees the stale's buffers with the set (`releaseVsmInvalidation`). */
export function releaseCastInvalidation(held: { casts?: VsmCastState }) {
  held.casts?.params.destroy()
  for (const buffer of Object.values(held.casts?.buffers ?? {})) buffer?.destroy()
  held.casts = undefined
}
