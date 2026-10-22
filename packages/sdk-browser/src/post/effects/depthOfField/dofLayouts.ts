import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { DOF_PARAMS_BINDING, DOF_STEP_BINDING } from './dofCommonWgsl.ts'
import { COC_FORMAT, COLOR_FORMAT, LUT_FORMAT, TILE_FORMAT } from './dofLayout.ts'
import { DILATE_BINDINGS, FLATTEN_BINDINGS } from './dofTilesWgsl.ts'
import { DOWNSAMPLE_BINDINGS, SETUP_BINDINGS } from './dofSetupWgsl.ts'
import { REDUCE_BINDINGS } from './dofReduceWgsl.ts'
import { LUT_BINDINGS } from './dofLutWgsl.ts'
import { GATHER_BINDINGS } from './dofGatherStateWgsl.ts'
import { POSTFILTER_BINDINGS } from './dofPostfilterWgsl.ts'
import { PACK_BINDINGS, SPRITE_BINDINGS } from './dofScatterWgsl.ts'
import { RECOMBINE_BINDINGS } from './dofRecombineWgsl.ts'

/**
 * The bind group layouts of the depth of field's passes, and its samplers. Every texture is a
 * half-float image, read filterable; every sampler is one of the three the gather reads through.
 */

/** The entries every layout is written from. */
const uniform = computeUniformEntry(DOF_PARAMS_BINDING)
const step = computeUniformEntry(DOF_STEP_BINDING)
const read = (binding: number) => computeTextureEntry(binding, 'float')
const depth = (binding: number) => computeTextureEntry(binding, 'depth')
const out = (binding: number, format: GPUTextureFormat = COLOR_FORMAT) =>
  computeStorageTextureEntry(binding, format)
const store = (binding: number) => computeBufferEntry(binding, 'storage')

/** The layout `entries` of `device`, labelled `label`. */
const layoutOf = (device: GPUDevice, label: string, entries: GPUBindGroupLayoutEntry[]) =>
  device.createBindGroupLayout({ label: `${DEPTH_OF_FIELD_PASS} ${label}`, entries })

/** The layouts of the setup, the tiles and their dilations. */
function setupLayouts(device: GPUDevice) {
  return {
    setup: layoutOf(device, 'setup', [
      uniform,
      read(SETUP_BINDINGS.scene),
      depth(SETUP_BINDINGS.depth),
      out(SETUP_BINDINGS.color),
      out(SETUP_BINDINGS.coc, COC_FORMAT),
    ]),
    flatten: layoutOf(device, 'flatten', [
      uniform,
      read(FLATTEN_BINDINGS.coc),
      out(FLATTEN_BINDINGS.fg, TILE_FORMAT),
      out(FLATTEN_BINDINGS.bg, TILE_FORMAT),
    ]),
    dilate: layoutOf(device, 'dilate', [
      uniform,
      step,
      read(DILATE_BINDINGS.fg),
      read(DILATE_BINDINGS.bg),
      read(DILATE_BINDINGS.minMaxFg),
      read(DILATE_BINDINGS.minMaxBg),
      out(DILATE_BINDINGS.outFg, TILE_FORMAT),
      out(DILATE_BINDINGS.outBg, TILE_FORMAT),
    ]),
    downsample: layoutOf(device, 'downsample', [
      uniform,
      read(DOWNSAMPLE_BINDINGS.color),
      read(DOWNSAMPLE_BINDINGS.coc),
      out(DOWNSAMPLE_BINDINGS.outColor),
      out(DOWNSAMPLE_BINDINGS.outCoc, COC_FORMAT),
    ]),
  }
}

/** The layouts of the reduction, the sprite lists' packing and the bokeh tables. */
function reduceLayouts(device: GPUDevice) {
  return {
    reduce: layoutOf(device, 'reduce', [
      uniform,
      step,
      read(REDUCE_BINDINGS.color),
      read(REDUCE_BINDINGS.coc),
      read(REDUCE_BINDINGS.quarter),
      out(REDUCE_BINDINGS.outColorA),
      out(REDUCE_BINDINGS.outCocA, COC_FORMAT),
      out(REDUCE_BINDINGS.outColorB),
      out(REDUCE_BINDINGS.outCocB, COC_FORMAT),
      store(REDUCE_BINDINGS.arguments),
      store(REDUCE_BINDINGS.foregroundList),
      store(REDUCE_BINDINGS.backgroundList),
    ]),
    pack: layoutOf(device, 'pack', [
      uniform,
      store(PACK_BINDINGS.arguments),
      store(PACK_BINDINGS.foregroundList),
      store(PACK_BINDINGS.backgroundList),
    ]),
    lut: layoutOf(device, 'table', [uniform, out(LUT_BINDINGS.lut, LUT_FORMAT)]),
  }
}

/** The layouts of the gather, its post-filter, the scattered sprites and the recombine. */
function layerLayouts(device: GPUDevice) {
  const drawn = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  return {
    gather: layoutOf(device, 'gather', [
      uniform,
      read(GATHER_BINDINGS.color),
      read(GATHER_BINDINGS.coc),
      read(GATHER_BINDINGS.tileFg),
      read(GATHER_BINDINGS.tileBg),
      read(GATHER_BINDINGS.lut),
      computeSamplerEntry(GATHER_BINDINGS.point),
      computeSamplerEntry(GATHER_BINDINGS.linear),
      computeSamplerEntry(GATHER_BINDINGS.wrapped),
      out(GATHER_BINDINGS.outColor),
      out(GATHER_BINDINGS.outAlpha, COC_FORMAT),
      out(GATHER_BINDINGS.outOcclusion, COC_FORMAT),
    ]),
    postfilter: layoutOf(device, 'post-filter', [
      uniform,
      read(POSTFILTER_BINDINGS.color),
      read(POSTFILTER_BINDINGS.alpha),
      read(POSTFILTER_BINDINGS.tileFg),
      read(POSTFILTER_BINDINGS.tileBg),
      out(POSTFILTER_BINDINGS.outColor),
      out(POSTFILTER_BINDINGS.outAlpha, COC_FORMAT),
    ]),
    sprites: layoutOf(device, 'sprites', [
      computeUniformEntry(DOF_PARAMS_BINDING, {}, drawn),
      computeBufferEntry(SPRITE_BINDINGS.list, 'read-only-storage', drawn),
      computeTextureEntry(SPRITE_BINDINGS.lut, 'float', '2d', GPUShaderStage.FRAGMENT),
      computeTextureEntry(SPRITE_BINDINGS.occlusion, 'float', '2d', GPUShaderStage.FRAGMENT),
      computeSamplerEntry(SPRITE_BINDINGS.sampler, 'filtering', GPUShaderStage.FRAGMENT),
    ]),
    recombine: layoutOf(device, 'recombine', [
      uniform,
      read(RECOMBINE_BINDINGS.scene),
      depth(RECOMBINE_BINDINGS.depth),
      read(RECOMBINE_BINDINGS.fgColor),
      read(RECOMBINE_BINDINGS.fgAlpha),
      read(RECOMBINE_BINDINGS.holeColor),
      read(RECOMBINE_BINDINGS.holeAlpha),
      read(RECOMBINE_BINDINGS.slightColor),
      read(RECOMBINE_BINDINGS.bgColor),
      read(RECOMBINE_BINDINGS.bgAlpha),
      read(RECOMBINE_BINDINGS.lut),
      computeSamplerEntry(RECOMBINE_BINDINGS.linear),
      computeSamplerEntry(RECOMBINE_BINDINGS.point),
      out(RECOMBINE_BINDINGS.out),
    ]),
  }
}

/** The bind group layout of each pass. */
export const dofLayouts = (device: GPUDevice) => ({
  ...setupLayouts(device),
  ...reduceLayouts(device),
  ...layerLayouts(device),
})

/** The three samplers the gather and the recombine read through. */
export function dofSamplers(device: GPUDevice) {
  const make = (label: string, filter: GPUFilterMode, wrap: GPUAddressMode) =>
    device.createSampler({
      label: `${DEPTH_OF_FIELD_PASS} ${label}`,
      magFilter: filter,
      minFilter: filter,
      addressModeU: wrap,
      addressModeV: wrap,
    })
  return {
    point: make('point sampler', 'nearest', 'clamp-to-edge'),
    linear: make('linear sampler', 'linear', 'clamp-to-edge'),
    wrapped: make('wrapped sampler', 'linear', 'repeat'),
  }
}
