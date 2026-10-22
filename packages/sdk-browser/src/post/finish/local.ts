import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { LOCAL_EXPOSURE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createGaussianStage, createGaussianTargets } from '../filters/gaussianStage.ts'
import { filterPrograms, type FilterPairs } from '../filters/filterPrograms.ts'
import { fullscreenDraw } from '../filters/fullscreenDraw.ts'
import type { SceneChain } from '../filters/sceneChain.ts'
import { BLURRED_LEVEL, FINISH_BYTES, GRID_DEPTH, GRID_TILE, finishLayout } from './finishLayout.ts'
import { createLayer } from './localLayer.ts'
import { GRID_WGSL, LOG_LIGHT_WGSL } from './localWgsl.ts'

/**
 * The local exposure's programs once a device, prepared off the thread: the grid, and the pass
 * that writes a level's log luminance for the blur (`localWgsl.ts`).
 */
const localPrograms = oncePerDevice((device: GPUDevice) => {
  const compute = GPUShaderStage.COMPUTE,
    fragment = GPUShaderStage.FRAGMENT
  const lightLabel = `${LOCAL_EXPOSURE_PASS} log light`,
    gridLabel = `${LOCAL_EXPOSURE_PASS} grid`
  const gridLayout = device.createBindGroupLayout({
    label: gridLabel,
    entries: [
      computeTextureEntry(0, 'unfilterable-float', '2d', compute),
      computeUniformEntry(1, { minBindingSize: FINISH_BYTES }, compute),
      computeStorageTextureEntry(2, 'rgba16float', 'write-only', '3d', compute),
    ],
  })
  const lightLayout = device.createBindGroupLayout({
    label: lightLabel,
    entries: [computeTextureEntry(0, 'unfilterable-float', '2d', fragment)],
  })
  const lightModule = device.createShaderModule({ label: lightLabel, code: LOG_LIGHT_WGSL })
  return {
    gridLayout,
    lightLayout,
    grid: preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [gridLayout] }),
      device.createShaderModule({ label: gridLabel, code: GRID_WGSL }),
      'grid',
      undefined,
      gridLabel,
    ),
    light: preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        lightModule,
        [lightLayout, finishLayout(device)],
        'logLight',
        [{ format: 'r16float' }],
        lightLabel,
      ),
    ),
  }
})

/** The filters the local exposure draws through: the scene's half-size image and its levels, and
 *  the blur of the log luminance. */
const FILTERS: FilterPairs = [
  ['halve', HDR_FORMAT],
  ['halveWide', HDR_FORMAT],
  ['blurTaps', 'r16float'],
]

/** Asks the local exposure's programs of `device` off the frame, the frames held until they
 *  landed (`../../frame/loop/framePipelines.ts`). */
export function askLocalPrograms(device: GPUDevice) {
  const { grid, light } = localPrograms(device)
  grid.ask()
  light.ask()
  filterPrograms(device).ask(FILTERS)
}

/** Whether the local exposure's programs are compiled: a frame that draws it compiles none. */
export function localProgramsReady(device: GPUDevice) {
  const { grid, light } = localPrograms(device)
  return grid.ready && light.ready && filterPrograms(device).ready(FILTERS)
}

/** The grid's texture over `tilesX × tilesY` tiles: `GRID_DEPTH` bands deep. */
const gridTexture = (width: number, height: number): GPUTextureDescriptor => ({
  label: LOCAL_EXPOSURE_PASS,
  size: { width, height, depthOrArrayLayers: GRID_DEPTH },
  dimension: '3d',
  format: 'rgba16float',
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

/** The texture of the log luminance, one channel, `width × height` texels. */
const lightTexture = (width: number, height: number): GPUTextureDescriptor => ({
  label: LOCAL_EXPOSURE_PASS,
  size: { width, height },
  format: 'r16float',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
})

type LocalPrograms = ReturnType<typeof localPrograms>

/** The bilateral grid of the half-size image: a kept layer, and the pass that draws it. */
function createGridPass(device: GPUDevice, uniform: GPUBuffer, programs: LocalPrograms) {
  const layer = createLayer(device, gridTexture, '3d')
  const computing = { label: `${LOCAL_EXPOSURE_PASS} grid` }
  const group = (first: GPUTextureView, grid: GPUTextureView) =>
    device.createBindGroup({
      layout: programs.gridLayout,
      entries: sequentialEntries([first, { buffer: uniform, size: FINISH_BYTES }, grid]),
    })
  return {
    get view() {
      return layer.view
    },
    get bytes() {
      return layer.bytes
    },
    /** Draws the grid of the half-size image `first`, `size` texels. */
    encode(encoder: GPUCommandEncoder, first: GPUTextureView, size: readonly number[]) {
      const tilesX = ceilDiv(size[0], GRID_TILE),
        tilesY = ceilDiv(size[1], GRID_TILE)
      layer.fit(tilesX, tilesY)
      const pass = encoder.beginComputePass(computing)
      pass.setPipeline(programs.grid.get())
      pass.setBindGroup(0, layer.groupOver(first, group))
      pass.dispatchWorkgroups(tilesX, tilesY)
      pass.end()
    },
    release: layer.release,
  }
}

/** The blurred log luminance of a level of the chain: a kept layer the level's log2 luminance is
 *  drawn into, and the Gaussian blur over it, mirrored at its edges. */
function createBlurredLight(device: GPUDevice, programs: LocalPrograms, bare: GPUBindGroup) {
  const layer = createLayer(device, lightTexture)
  const targets = createGaussianTargets(device, 'r16float', LOCAL_EXPOSURE_PASS)
  const blur = createGaussianStage(device, { edge: 'mirror', targets })
  const draw = fullscreenDraw(LOCAL_EXPOSURE_PASS)
  const group = (source: GPUTextureView) =>
    device.createBindGroup({ layout: programs.lightLayout, entries: sequentialEntries([source]) })
  return {
    /** The blur, at the level's size. */
    get view() {
      return blur.view
    },
    /** Bytes of the log luminance and the blur's targets. */
    get bytes() {
      return layer.bytes + targets.bytes
    },
    /** Draws the log luminance of `source`, a level of `size` texels, and blurs it over `percent`
     *  of its width. */
    encode(
      encoder: GPUCommandEncoder,
      source: GPUTextureView,
      size: readonly number[],
      percent: number,
    ) {
      layer.fit(size[0], size[1])
      draw(encoder, layer.view!, programs.light.get(), layer.groupOver(source, group), bare)
      blur.resize(size[0], size[1], percent)
      blur.encode(encoder, layer.view!)
    },
    release() {
      layer.release()
      blur.dispose()
      targets.dispose()
    },
  }
}

/**
 * THE LOCAL EXPOSURE'S TWO BASE LAYERS, built from the scene's chain (`../filters/sceneChain.ts`):
 * the bilateral grid of the half-size image — a 3D image of one tile of `GRID_TILE` pixels a texel
 * across and `GRID_DEPTH` bands of log luminance deep (`GRID_WGSL`) —, and the blurred log
 * luminance of the chain's fifth level: its log2 luminance in one channel, Gaussian-blurred over
 * `percent` of its width, mirrored at its edges. `uniform` is the finishing's, which holds how a
 * luminance is read; `bare` the finishing's group with nothing in the slots the passes write.
 * The images are kept while the size holds; a frame allocates none.
 */
export function createLocalExposure(device: GPUDevice, uniform: GPUBuffer, bare: GPUBindGroup) {
  const programs = localPrograms(device)
  const grid = createGridPass(device, uniform, programs)
  const light = createBlurredLight(device, programs, bare)
  let blurring = false
  const release = () => {
    grid.release()
    light.release()
    blurring = false
  }
  return {
    /** The grid, to sample, once drawn; the blurred log luminance, once drawn with a blur. */
    get grid() {
      return grid.view
    },
    get blurred() {
      return blurring ? light.view : undefined
    },
    /** Bytes of the grid, the log luminance and the blur's targets. */
    get bytes() {
      return grid.bytes + light.bytes
    },
    /**
     * Draws the layers of the frame's image into the chain `scene` was begun with: the grid, and
     * with `percent` of a blur above 0 the log luminance of the fifth level and its blur. They
     * read the finishing's uniform, whose exposure the frame copied in.
     */
    encode(encoder: GPUCommandEncoder, scene: SceneChain, percent: number, blurred: boolean) {
      blurring = blurred
      scene.need(blurred ? BLURRED_LEVEL + 1 : 1)
      grid.encode(encoder, scene.view(0)!, scene.size(0))
      if (blurred)
        light.encode(encoder, scene.view(BLURRED_LEVEL)!, scene.size(BLURRED_LEVEL), percent)
    },
    dispose: release,
  }
}
