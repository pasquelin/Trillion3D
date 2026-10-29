import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { HAIR_COMPOSE_GROUP, hairComposeWgsl } from './compositionWgsl.ts'
import { boundGroups } from './ribbonBinds.ts'
import type { HairNodes } from './compactionPass.ts'
import type { HairTiles } from './tilesPass.ts'
import { HAIR_ALL_TILES_DRAW } from './visibilityMath.ts'

/** The strands' own group of the composition: the image block, the tiles, the descriptors, the coverage, the light, the
 *  count of samples and the nearest strand's depth. */
const composeLayout = oncePerDevice((device) => {
  const G = HAIR_COMPOSE_GROUP
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const texture = (binding: number, sampleType: GPUTextureSampleType): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType },
  })
  return device.createBindGroupLayout({
    label: `${HAIR_STRANDS_PASS_PREFIX}composition`,
    entries: [
      { binding: G.image, visibility: both, buffer: { type: 'uniform' } },
      {
        binding: G.tiles,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
      texture(G.nodeIndex, 'uint'),
      texture(G.coverage, 'unfilterable-float'),
      texture(G.light, 'unfilterable-float'),
      {
        binding: G.nodeCounter,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      texture(G.nearestDepth, 'unfilterable-float'),
    ],
  })
})

const pipelines = new WeakMap<GPUBindGroupLayout, Map<boolean, ReturnType<typeof makePipeline>>>()

/** The pipeline that lays the strands on the lit image (`hairComposeWgsl`) over the fog pass's group 0 `fogLayout`: the
 *  strands over what is under them, as much as they cover; with `forward`, the colour the forward raster shaded. Made once for a layout and form; `get()` gives it, none while it compiles. */
export function hairComposePipeline(
  device: GPUDevice,
  fogLayout: GPUBindGroupLayout,
  localFog: boolean,
  forward = false,
) {
  let forms = pipelines.get(fogLayout)
  if (!forms) pipelines.set(fogLayout, (forms = new Map()))
  let made = forms.get(forward)
  if (!made) forms.set(forward, (made = makePipeline(device, fogLayout, localFog, forward)))
  return made
}

function makePipeline(
  device: GPUDevice,
  fogLayout: GPUBindGroupLayout,
  localFog: boolean,
  forward: boolean,
) {
  const name = `${HAIR_STRANDS_PASS_PREFIX}composition${forward ? ' forward' : ''}`
  const module = device.createShaderModule({
    label: name,
    code: wgslModule(hairComposeWgsl(localFog)),
  })
  return preparedPipeline(device, {
    label: name,
    layout: device.createPipelineLayout({ bindGroupLayouts: [fogLayout, composeLayout(device)] }),
    vertex: { module, entryPoint: 'hairComposeVs' },
    fragment: {
      module,
      entryPoint: forward ? 'hairForwardComposeFs' : 'hairComposeFs',
      targets: [
        {
          format: HDR_FORMAT,
          blend: {
            color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  })
}

/** What the composition reads of the image, besides the tiles and the samples. */
export interface HairComposeSources {
  /** The size drawn and the room of a list of tiles (`HAIR_COMPOSE_IMAGE_WORDS` words). */
  readonly image: GPUBuffer
  readonly nodeIndexView: GPUTextureView
  readonly coverageView: GPUTextureView
  /** The nearest strand's depth of each pixel. */
  readonly nearestDepth: GPUTextureView
  /** The strands' light, a sample a texel (`encodeHairLight`). */
  readonly light: GPUTextureView
}

/** The bind group of the strands' own group, kept while the resources it names stay. */
export const hairComposeBinds = () =>
  boundGroups<HairTiles, HairNodes, HairComposeSources>(
    1,
    (device, pipeline, tiles, nodes, sources) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: sequentialEntries([
          { buffer: sources.image },
          { buffer: tiles.data },
          sources.nodeIndexView,
          sources.coverageView,
          sources.light,
          { buffer: nodes.nodeCounter },
          sources.nearestDepth,
        ]),
      }),
  )

/** Lays the strands over `target`, the lit image, drawing the tiles with strands of an image of `size`; `fogGroup` is the
 *  fog pass's group 0. */
export function encodeHairComposition(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  fogGroup: GPUBindGroup,
  binds: ReturnType<typeof hairComposeBinds>,
  tiles: HairTiles,
  nodes: HairNodes,
  sources: HairComposeSources,
  target: GPUTextureView,
  size: readonly [number, number],
) {
  const pass = encoder.beginRenderPass({
    label: `${HAIR_STRANDS_PASS_PREFIX}composition`,
    colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
  })
  pass.setViewport(0, 0, size[0], size[1], 0, 1)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, fogGroup)
  pass.setBindGroup(1, binds(device, pipeline, tiles, nodes, sources))
  pass.drawIndirect(tiles.drawArgs, HAIR_ALL_TILES_DRAW)
  pass.end()
}
