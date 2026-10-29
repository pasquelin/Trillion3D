import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { uniformBlock, type UniformBlock } from '../gpu/core/uniformBlock.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import type { HairNodes } from './compactionPass.ts'
import { HAIR_CUSTOM_DEPTH_WGSL } from './customDepthWgsl.ts'
import { boundGroups } from './ribbonBinds.ts'
import type { HairTiles } from './tilesPass.ts'
import { HAIR_ALL_TILES_DRAW } from './visibilityMath.ts'

const LABEL = `${HAIR_STRANDS_PASS_PREFIX}custom depth`

const module = oncePerDevice((device) =>
  device.createShaderModule({ label: LABEL, code: HAIR_CUSTOM_DEPTH_WGSL }),
)
const pipeline = oncePerDevice((device) => {
  const code = module(device)
  return preparedPipeline(device, {
    label: LABEL,
    layout: 'auto',
    vertex: { module: code, entryPoint: 'hairTileQuadVs' },
    fragment: { module: code, entryPoint: 'hairCustomDepthFs', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    // Reverse-Z: the nearer of two strands' samples a pixel's first holds is the greater.
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater-equal' },
  })
})

/** The textures of the image the pass reads (`HairImageTargets`). */
interface HairCustomDepthTargets {
  readonly nodeIndexView: GPUTextureView
  readonly coverageView: GPUTextureView
}

/**
 * THE CUSTOM DEPTH OF A VIEW: a depth target the size of the image, cleared to 0 (no strand) and written, each image the setting
 * `hairRenderCustomDepth` is on, with the depth of the strands that render custom depth (`encodeHairCustomDepth`). A pass that
 * wants to know where those strands are reads `view`; it is made again where the image's size moves and goes with the view.
 */
export function createHairCustomDepth(device: GPUDevice, image: GPUBuffer) {
  // Made by the first image, and again by the first after a `dispose`.
  let rule: UniformBlock | undefined
  let texture: GPUTexture | undefined
  let view: GPUTextureView | undefined
  const drop = () => {
    if (texture) retire(device, texture)
    texture = view = undefined
  }
  const binds = boundGroups<HairTiles, HairNodes, HairCustomDepthTargets>(
    1,
    (made, layoutOf, tiles, nodes, targets) =>
      made.createBindGroup({
        layout: layoutOf.getBindGroupLayout(0),
        entries: sequentialEntries([
          { buffer: image },
          { buffer: tiles.data },
          targets.nodeIndexView,
          { buffer: nodes.nodeData },
          targets.coverageView,
          { buffer: rule!.buffer },
        ]),
      }),
  )
  return {
    /** The depth written the last image it was asked for, none before or once it was given back. */
    get view() {
      return view
    },
    /** Gives the texture back, which no pass reads. */
    release: drop,
    dispose() {
      drop()
      rule?.buffer.destroy()
      rule = undefined
    },
    /**
     * Draws the tiles with strands of an image of `size` into the custom depth, made at that size: the strands whose
     * first sample renders custom depth and covers the pixel to `coverageThreshold` write their depth. None while the
     * pipeline compiles (the image keeps the depth it had cleared).
     */
    encode(
      device: GPUDevice,
      encoder: GPUCommandEncoder,
      tiles: HairTiles,
      nodes: HairNodes,
      targets: HairCustomDepthTargets,
      size: readonly [number, number],
      coverageThreshold: number,
    ) {
      if (!texture || texture.width !== size[0] || texture.height !== size[1]) {
        drop()
        texture = device.createTexture({
          label: LABEL,
          size: { width: size[0], height: size[1] },
          format: DEPTH_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        view = texture.createView()
      }
      const draw = pipeline(device).get()
      rule ??= uniformBlock(device, `${LABEL} rule`, 16)
      rule.words.f[0] = coverageThreshold
      rule.send()
      const pass = encoder.beginRenderPass({
        label: LABEL,
        colorAttachments: [],
        depthStencilAttachment: {
          view: view!,
          depthLoadOp: 'clear',
          depthClearValue: 0,
          depthStoreOp: 'store',
        },
      })
      if (draw) {
        pass.setViewport(0, 0, size[0], size[1], 0, 1)
        pass.setPipeline(draw)
        pass.setBindGroup(0, binds(device, draw, tiles, nodes, targets))
        pass.drawIndirect(tiles.drawArgs, HAIR_ALL_TILES_DRAW)
      }
      pass.end()
    },
  }
}

/** A view's custom depth (`createHairCustomDepth`). */
export type HairCustomDepth = ReturnType<typeof createHairCustomDepth>
