import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { uniformBlock, type UniformBlock } from '../../gpu/core/uniformBlock.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import type { HairScene } from '../scene.ts'
import { RENDER_CURVE_BINNING_WGSL } from './binningWgsl.ts'
import { RENDER_CURVE_COMPACTION_WGSL } from './compactionWgsl.ts'
import {
  RENDER_CURVE_CLUSTER_CULL_WGSL,
  RENDER_CURVE_CULL_LANES,
  RENDER_CURVE_INSTANCE_CULL_WGSL,
} from './cullWgsl.ts'
import { RENDER_CURVE_HZB_WGSL, renderCurveHzbLevels } from './hzbWgsl.ts'
import { RENDER_CURVE_INDIRECT_ARGS_WGSL } from './indirectArgsWgsl.ts'
import { RENDER_CURVE_PARAMS_BYTES } from './paramsWgsl.ts'
import {
  createRenderCurveBuffers,
  renderCurveBuffersKey,
  renderCurveMaxVisibleClusters,
  type RenderCurveBuffers,
} from './renderCurveBuffers.ts'
import type { RenderCurveCommon } from './renderCurveMath.ts'
import {
  RENDER_CURVE_MAX_TILES_PER_SIDE,
  writeRenderCurveParams,
  type RenderCurveView,
} from './renderCurveParams.ts'
import {
  createRenderCurveScene,
  writeRenderCurveInstances,
  type RenderCurveSceneGpu,
} from './renderCurveScene.ts'
import { RENDER_CURVE_OUTPUT_FORMAT, RENDER_CURVE_RASTER_WGSL } from './rasterWgsl.ts'
import {
  RENDER_CURVE_SCENE_TILE_DEPTH_WGSL,
  RENDER_CURVE_TILE_DEPTH_FORMAT,
} from './sceneTileDepthWgsl.ts'

const PREFIX = `${HAIR_STRANDS_PASS_PREFIX}curve raster `
const kernel = (name: string, code: string, entry: string) =>
  autoKernel(`${PREFIX}${name}`, code, entry)
const kernels = {
  hzb: kernel('furthest depth', RENDER_CURVE_HZB_WGSL, 'hzbBuild'),
  tileDepth: kernel('scene tile depth', RENDER_CURVE_SCENE_TILE_DEPTH_WGSL, 'sceneTileDepth'),
  instanceCull: kernel('instance culling', RENDER_CURVE_INSTANCE_CULL_WGSL, 'instanceCulling'),
  clusterCull: kernel('cluster culling', RENDER_CURVE_CLUSTER_CULL_WGSL, 'clusterCulling'),
  indirectArgs: kernel('indirect args', RENDER_CURVE_INDIRECT_ARGS_WGSL, 'indirectArgs'),
  binning: kernel('binning', RENDER_CURVE_BINNING_WGSL, 'binning'),
  compaction: kernel('compaction', RENDER_CURVE_COMPACTION_WGSL, 'compaction'),
  raster: kernel('raster', RENDER_CURVE_RASTER_WGSL, 'rasterize'),
}

/** The pipelines of every stage on `device`, none while one compiles. */
function pipelines(device: GPUDevice) {
  const made = {
    hzb: kernels.hzb(device).get(),
    tileDepth: kernels.tileDepth(device).get(),
    instanceCull: kernels.instanceCull(device).get(),
    clusterCull: kernels.clusterCull(device).get(),
    indirectArgs: kernels.indirectArgs(device).get(),
    binning: kernels.binning(device).get(),
    compaction: kernels.compaction(device).get(),
    raster: kernels.raster(device).get(),
  }
  return Object.values(made).every(Boolean)
    ? (made as Record<keyof typeof made, GPUComputePipeline>)
    : undefined
}

/** The texture of the scene's depth per bin tile of an image (`RENDER_CURVE_TILE_DEPTH_FORMAT`): one texel a tile. */
const renderCurveTileDepthTexture = (device: GPUDevice, common: RenderCurveCommon) =>
  device.createTexture({
    label: `${PREFIX}scene tile depth`,
    size: { width: common.binTileRes[0], height: common.binTileRes[1] },
    format: RENDER_CURVE_TILE_DEPTH_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

/** The image the raster draws (`RENDER_CURVE_OUTPUT_FORMAT`), the size of the image, cleared before it is drawn. */
const renderCurveOutputTexture = (device: GPUDevice, common: RenderCurveCommon) =>
  device.createTexture({
    label: `${PREFIX}output`,
    size: { width: common.resolution[0], height: common.resolution[1] },
    format: RENDER_CURVE_OUTPUT_FORMAT,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })

/** What an image of the curve raster reads: the scene (its strands cut into clusters), and the view. */
export interface RenderCurveSource extends RenderCurveView {
  readonly scene: HairScene
}

/**
 * THE CURVE RASTER'S STATE OF A VIEW (the pipeline of `renderCurve`): the shared block, the scene's clusters, the buffers its passes
 * fill (made again where the image's size or the scene moves) and the scene's depth per bin tile; given back with `release`. Only
 * the compute path exists: the device's rasterizer has no mesh shader to draw the clusters with.
 */
export function createRenderCurve(device: GPUDevice) {
  // Made by the first image: a view that never runs the raster holds no buffer.
  let params: UniformBlock | undefined
  let scene: RenderCurveSceneGpu | undefined
  let buffers: (RenderCurveBuffers & { key: string }) | undefined
  let texture: GPUTexture | undefined
  let tileDepthView: GPUTextureView | undefined
  let outputTexture: GPUTexture | undefined
  let outputView: GPUTextureView | undefined
  let levelBlocks: GPUBuffer[] = []
  // Whether the image drawn last is in the output.
  let drawn = false
  const releaseSize = () => {
    buffers?.destroy()
    buffers = undefined
    if (texture) retire(device, texture)
    if (outputTexture) retire(device, outputTexture)
    texture = tileDepthView = outputTexture = outputView = undefined
    drawn = false
    for (const block of levelBlocks) retire(device, block)
    levelBlocks = []
  }
  const release = () => {
    releaseSize()
    scene?.dispose()
    scene = undefined
  }
  return {
    /** The image the raster drew, none where it drew nothing this image. */
    get output() {
      return drawn ? outputView : undefined
    },
    release,
    dispose() {
      release()
      params?.buffer.destroy()
      params = undefined
    },
    /**
     * Runs the curve raster's stages over the scene's depth `sceneDepth` of an image of `common`'s size, in one compute pass: the furthest
     * depth pyramid and the depth per tile, the cull of the instances then of their clusters, the count of the visible clusters, the
     * binning of their segments into tiles, the compaction of each tile's segments into z bins and the raster of the z bins into the output
     * (cleared first). Nothing while a stage compiles.
     */
    encode(
      encoder: GPUCommandEncoder,
      common: RenderCurveCommon,
      sceneDepth: GPUTextureView,
      source: RenderCurveSource,
    ) {
      drawn = false
      const { instances } = source.scene
      const tiles = common.binTileRes
      if (
        !instances.length ||
        tiles[0] > RENDER_CURVE_MAX_TILES_PER_SIDE ||
        tiles[1] > RENDER_CURVE_MAX_TILES_PER_SIDE
      )
        return
      const made = pipelines(device)
      if (!made) return
      const capBytes = storageBufferCap(device.limits)
      if (scene?.scene !== source.scene) {
        scene?.dispose()
        scene = createRenderCurveScene(device, source.scene, capBytes)
      }
      const maxVisible = renderCurveMaxVisibleClusters(instances.length, capBytes)
      const key = renderCurveBuffersKey(common, instances.length, maxVisible)
      if (!buffers || buffers.key !== key || !texture) {
        releaseSize()
        buffers = { ...createRenderCurveBuffers(device, common, instances.length, maxVisible), key }
        texture = renderCurveTileDepthTexture(device, common)
        tileDepthView = texture.createView()
        outputTexture = renderCurveOutputTexture(device, common)
        outputView = outputTexture.createView()
        levelBlocks = Array.from(
          { length: renderCurveHzbLevels(...common.resolution) },
          (_, level) => {
            const block = device.createBuffer({
              label: `${PREFIX}furthest depth level ${level}`,
              size: 16,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
            device.queue.writeBuffer(block, 0, new Uint32Array([level, 0, 0, 0]))
            return block
          },
        )
      }
      params ??= uniformBlock(device, `${PREFIX}parameters`, RENDER_CURVE_PARAMS_BYTES)
      writeRenderCurveParams(params.words, common, source, {
        instanceCount: instances.length,
        clusterCount: scene.clusterCount,
        strideWords: scene.strideWords,
        maxVisible,
      })
      params.send()
      writeRenderCurveInstances(device, scene, instances, source.eye)
      for (const buffer of buffers.cleared) encoder.clearBuffer(buffer)
      encoder
        .beginRenderPass({
          label: `${PREFIX}clear output`,
          colorAttachments: [{ view: outputView!, loadOp: 'clear', storeOp: 'store' }],
        })
        .end()
      const pass = encoder.beginComputePass({ label: `${PREFIX}pipeline` })
      const bound = (pipeline: GPUComputePipeline, resources: readonly GPUBindingResource[]) => {
        pass.setPipeline(pipeline)
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: sequentialEntries(resources),
          }),
        )
      }
      const bufferOf = (b: GPUBuffer): GPUBindingResource => ({ buffer: b })
      const shared = bufferOf(params.buffer)
      const held = buffers
      const { counters, hzb } = held
      levelBlocks.forEach((block, level) => {
        const side = 2 ** (level + 1)
        bound(made.hzb, [shared, bufferOf(block), sceneDepth, bufferOf(hzb)])
        pass.dispatchWorkgroups(
          ceilDiv(ceilDiv(common.resolution[0], side), 8),
          ceilDiv(ceilDiv(common.resolution[1], side), 8),
        )
      })
      bound(made.tileDepth, [shared, sceneDepth, tileDepthView!])
      pass.dispatchWorkgroups(tiles[0], tiles[1])
      bound(made.instanceCull, [
        shared,
        bufferOf(scene.instances),
        bufferOf(held.instanceArgs),
        bufferOf(held.visibleInstances),
        bufferOf(counters),
        bufferOf(hzb),
      ])
      pass.dispatchWorkgroups(ceilDiv(instances.length, RENDER_CURVE_CULL_LANES))
      bound(made.clusterCull, [
        shared,
        bufferOf(scene.instances),
        bufferOf(held.instanceArgs),
        bufferOf(held.visibleInstances),
        bufferOf(held.visibleClusters),
        bufferOf(counters),
        bufferOf(scene.clusters),
        bufferOf(hzb),
      ])
      pass.dispatchWorkgroupsIndirect(held.instanceArgs, 0)
      bound(made.indirectArgs, [shared, bufferOf(counters)])
      pass.dispatchWorkgroups(1)
      bound(made.binning, [
        shared,
        bufferOf(scene.instances),
        bufferOf(scene.clusters),
        bufferOf(held.visibleClusters),
        bufferOf(counters),
        bufferOf(held.tileSegments),
        bufferOf(held.tileData),
        bufferOf(held.segmentData),
        tileDepthView!,
      ])
      pass.dispatchWorkgroups(common.numBinners)
      bound(made.compaction, [
        shared,
        bufferOf(counters),
        bufferOf(held.tileData),
        bufferOf(held.segmentData),
        bufferOf(held.zBinData),
        bufferOf(held.zBinSegments),
        bufferOf(held.rasterWork),
        tileDepthView!,
      ])
      pass.dispatchWorkgroups(tiles[0], tiles[1])
      bound(made.raster, [
        shared,
        bufferOf(counters),
        bufferOf(held.zBinData),
        bufferOf(held.zBinSegments),
        bufferOf(held.rasterWork),
        sceneDepth,
        outputView!,
      ])
      pass.dispatchWorkgroups(common.numRasterizers)
      pass.end()
      drawn = true
    },
  }
}

/** A view's curve raster state (`createRenderCurve`). */
export type RenderCurve = ReturnType<typeof createRenderCurve>
