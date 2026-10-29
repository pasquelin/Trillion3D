/**
 * THE SINGLE-LAYER WATER'S SUN SHADOW (`projectionWgsl.ts`, input `water`): the suns' projection run over the
 * tiles that hold water, on the water's own depth and normals (the surface the shading wrote), a layer of the
 * mask a sun of the frame — the share of its shadow at each water pixel. The frame's projection context is
 * the opaque one's (`writeVsmProjectionFrame`, its view uniform and light records), so the same maps, the same
 * bias and the same noise shade the water as the surfaces under it; the water pass multiplies its separated sun
 * by the layer of the forward sun (`blend/water/waterSunShadow.ts`).
 */
import { chainReady } from '../../../deferred/fullscreen.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { namedEntries } from '../../../../gpu/core/computeBindings.ts'
import { hizDepthBindEntries } from '../../../../visibility/hiz/gpu/pyramidTexture.ts'
import { vsmPerFrameSet, type VsmResources } from '../resources.ts'
import { VSM_PROJECTION_BINDING } from './projectionWgsl.ts'
import {
  pipelinesFor,
  sunsPipeline,
  tablesGroup,
  VSM_PROJECTION_PASS,
} from './projectionPipelines.ts'
import { vsmProjectionReserve, vsmWaterState } from './projectionStore.ts'
import { VSM_SUN_MASK_FORMAT } from './maskFormat.ts'
import { sunCount } from './projectionView.ts'
import type { VsmProjectionFrame } from './projectionPass.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'

/** What the water's sun projection reads: the water's depth and the normals its shading wrote (zero where
 *  there is no water), the list of the tiles that hold water, their count (a uniform) and the indirect
 *  dispatch over the list (`blend/water/waterTileWgsl.ts`). */
export interface VsmWaterSunSource {
  depth: GPUTextureView
  normals: GPUTextureView
  tiles: GPUBuffer
  count: GPUBuffer
  dispatch: GPUBuffer
}

const WATER_PASS: GPUComputePassDescriptor = { label: VSM_PROJECTION_PASS }

/** Whether the suns' program over the water is compiled (it is asked to compile otherwise). */
export function waterSunProjectionReady(device: GPUDevice, res: VsmResources) {
  const p = pipelinesFor(device, res.layout)
  return chainReady(sunsPipeline(p, 'water'))
}

/** The mask of the water's sun shadow for `layers` suns at `width` × `height`, made again when its size moved. */
function ensureMask(
  device: GPUDevice,
  held: NonNullable<ReturnType<typeof vsmWaterState>>,
  width: number,
  height: number,
  layers: number,
) {
  const mask = held.mask
  if (mask && mask.width === width && mask.height === height && mask.depthOrArrayLayers === layers)
    return held.view!
  if (mask) retire(device, mask)
  held.mask = device.createTexture({
    label: 'vsm.projection.water.mask',
    size: [width, height, layers],
    format: VSM_SUN_MASK_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  return (held.view = held.mask.createView({ dimension: '2d-array' }))
}

/**
 * Projects the frame's suns onto the water's surface (`source`) over the tiles that hold water: one dispatch
 * indirect from the list, into a layer of the returned mask a sun of `frame` (`writeVsmProjectionFrame`,
 * written this frame). None, and nothing encoded, while the program compiles, the frame has no sun or the
 * blue noise is not made.
 */
export function encodeWaterSunProjection(
  steps: ComputeRun,
  res: VsmResources,
  frame: VsmProjectionFrame,
  source: VsmWaterSunSource,
) {
  const { device, width, height, lights } = frame
  const suns = sunCount(lights)
  const state = vsmProjectionReserve(device, res)
  if (!suns || !state.blueNoiseView || !state.uniform) return undefined
  const p = pipelinesFor(device, res.layout)
  const compiled = sunsPipeline(p, 'water').get()
  if (!compiled) return undefined
  const held = vsmWaterState(state)
  const mask = ensureMask(device, held, width, height, suns)
  const group = held.group
  const { next } = group.identity
  next[0] = p.water!.sunsLayout
  next[1] = source.depth
  next[2] = source.normals
  next[3] = frame.hizDepth
  next[4] = mask
  next[5] = source.tiles
  next[6] = source.count
  next[7] = res.filterable?.merged
  next[8] = state.uniform
  next[9] = state.blueNoiseView
  if (group.identity.moved())
    group.group = device.createBindGroup({
      label: 'vsm.projection.water',
      layout: p.water!.sunsLayout,
      entries: [
        ...namedEntries(VSM_PROJECTION_BINDING, {
          view: { buffer: state.uniform },
          sceneDepth: source.depth,
          normalRough: source.normals,
          blueNoise: state.blueNoiseView,
          mask,
          strandsCounts: { buffer: source.count },
          strandsTiles: { buffer: source.tiles },
          ...(res.filterable?.merged && { filterableMerged: { buffer: res.filterable.merged } }),
        }),
        ...hizDepthBindEntries(VSM_PROJECTION_BINDING.hizDepth, frame.hizDepth),
      ],
    })
  const pass = steps.pass(WATER_PASS)
  pass.setBindGroup(0, vsmPerFrameSet(state.tables, res, tablesGroup, p, p.vsmLayout))
  pass.setPipeline(compiled)
  pass.setBindGroup(1, group.group!)
  pass.dispatchWorkgroupsIndirect(source.dispatch, 0)
  return mask
}
