// The hair strands' visibility (`packages/sdk-browser/src/hair/visibility.ts`) run on a real device over
// ribbons whose coverage is known in closed form (`visibilityScenes.ts`), then read back and checked
// (`visibilityChecks.ts`).
import {
  readGpuBuffer,
  readGpuImage,
  readGpuTextureR32F,
} from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { destroyRetired } from '../../../packages/sdk-browser/src/gpu/core/frameRetire.ts'
import { pipelinesSettled } from '../../../packages/sdk-browser/src/lighting/deferred/compileLedger.ts'
import { gpuCapsOf } from '../../../packages/sdk-browser/src/gpu/core/gpuCaps.ts'
import { multiplyMatrix4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { cameraForward } from '../../../packages/sdk-browser/src/camera/forward.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'
import type { HairFrameInputs } from '../../../packages/sdk-browser/src/hair/inputs.ts'
import {
  createHairScene,
  encodeHairScene,
  planHairView,
} from '../../../packages/sdk-browser/src/hair/scene.ts'
import { createHairViewGpu } from '../../../packages/sdk-browser/src/hair/viewGpu.ts'
import { encodeHairVisibility } from '../../../packages/sdk-browser/src/hair/visibility.ts'
import {
  HAIR_DISPATCH_ARGS_WORDS,
  HAIR_DRAW_ARGS_WORDS,
  HAIR_NODE_COUNTERS,
  HAIR_NODE_COUNTER_PLACED,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_DATA_WORDS,
  HAIR_SAMPLE_BYTES,
  HAIR_TILE_LISTS,
  HAIR_TILE_SIZE,
  hairTileGrid,
} from '../../../packages/sdk-browser/src/hair/visibilityMath.ts'
import { hairFlagsOf } from '../../../packages/sdk-browser/src/hair/visibilityBlocks.ts'
import { createSurfaceBuffer } from '../../../packages/sdk-browser/src/materials/surface/surfaceAllocation.ts'
import { SURFACE_COLOUR_LAYERS } from '../../../packages/sdk-browser/src/materials/surface/surfaceOutputs.ts'
import { invertMatrix4 } from '../../../packages/math/src/matrix/matrix4Inverse.ts'
import {
  checkCompaction,
  checkGbuffer,
  checkMaterial,
  checkRuns,
  checkSamples,
  checkTiles,
  checkTransmittance,
  type Readbacks,
} from './visibilityChecks.ts'
import {
  closedForm,
  FULL_COVERAGE,
  HEIGHT,
  nearStrands,
  RASTERIZATION_SCALE,
  proofCamera,
  SAMPLES,
  SCENES,
  strandsOf,
  WIDTH,
  type SceneName,
} from './visibilityScenes.ts'

/** `transmittance` with 1 outside the tiles `tiles` (`[x0, y0, x1, y1]`) of the strands' rectangle: the
 *  pixels no pass reads are not cleared, and hold what they held. */
function insideTiles(transmittance: Float32Array, tiles: readonly number[]) {
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++)
      if (
        x < tiles[0]! * HAIR_TILE_SIZE ||
        x >= tiles[2]! * HAIR_TILE_SIZE ||
        y < tiles[1]! * HAIR_TILE_SIZE ||
        y >= tiles[3]! * HAIR_TILE_SIZE
      )
        transmittance[y * WIDTH + x] = 1
  return transmittance
}

/** Runs the strands' visibility of `scene` (`near`: the strand that crosses the near plane) on a device
 *  opened without the features `off` names, with an opaque surface in front of the strands if
 *  `occluder`, and checks what it wrote. The surfaces are handed, so the patch of them runs too. */
export async function runHairVisibility(input: {
  scene: SceneName | 'near'
  off: GPUFeatureName[]
  occluder: boolean
}) {
  const gpu = await openGpuDevice([], {}, input.off)
  if (!gpu) return { unavailable: true as const }
  const { device } = gpu
  const ribbons = input.scene === 'near' ? [] : SCENES[input.scene].ribbons
  const strands =
    input.scene === 'near' ? nearStrands() : strandsOf(ribbons, SCENES[input.scene].radius)
  const scene = createHairScene(device, strands, true)
  const cam = proofCamera()
  const depth = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'depth32float',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  })
  // The surfaces the strands may empty, lit everywhere before: the flags of a physical surface and a
  // white base colour and normal.
  const surfaces = createSurfaceBuffer(device, WIDTH, HEIGHT)
  const LIT_FLAGS = 2
  device.queue.writeTexture(
    { texture: surfaces.words },
    new Uint32Array(WIDTH * HEIGHT).fill(LIT_FLAGS),
    { bytesPerRow: WIDTH * 4 },
    [WIDTH, HEIGHT, 1],
  )
  for (const layer of [SURFACE_COLOUR_LAYERS.base, SURFACE_COLOUR_LAYERS.normal])
    device.queue.writeTexture(
      { texture: surfaces.colours, origin: [0, 0, layer] },
      new Uint16Array(WIDTH * HEIGHT * 4).fill(0x3c00),
      { bytesPerRow: WIDTH * 8 },
      [WIDTH, HEIGHT, 1],
    )
  const flags = hairFlagsOf(false, false, true)
  const depthView = depth.createView()
  // What a frame would hand the passes: the image's inputs, the settings at their defaults.
  const viewProjection = new Float64Array(16)
  multiplyMatrix4(viewProjection, cam.projection, cam.viewRelative)
  const inverse = new Float64Array(16)
  invertMatrix4(inverse, viewProjection)
  const inputs: HairFrameInputs = {
    camera: cam,
    size: [WIDTH, HEIGHT],
    allocated: [WIDTH, HEIGHT],
    depthView,
    viewProjection,
    inverseViewProjection: inverse,
    forward: cameraForward(new Float64Array(3), cam.world),
    pixelSize: [WIDTH, HEIGHT],
    sizeInPixel: 1,
    pageResolution: 32,
    samplesPerPixel: SAMPLES,
    meanSamplesPerPixel: 0.75,
    rasterizationScale: RASTERIZATION_SCALE,
    stableRasterizationScale: 1,
    flags,
    sortByDepth: false,
    fullCoverage: FULL_COVERAGE,
    surfaces: surfaces.stores(),
    emissionLayer: surfaces.layers & 255,
    shadow: undefined,
  }
  const view = createHairViewGpu(device, scene, inputs, true)
  const failures: unknown[] = []
  const encodeImage = (encoder: GPUCommandEncoder) => {
    encoder
      .beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: input.occluder ? 0.5 : 0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      })
      .end()
    const macroGroups = planHairView(scene.instances, view.bounds.update, view.lists, inputs)
    encodeHairScene(device, encoder, scene, view.bounds)
    return encodeHairVisibility(device, encoder, view, macroGroups, (error) => failures.push(error))
  }
  // The first image asks the programs; the one that finds them compiled runs them.
  encodeImage(device.createCommandEncoder())
  await pipelinesSettled(device)
  const encoder = device.createCommandEncoder()
  const image = encodeImage(encoder)
  device.queue.submit([encoder.finish()])
  const base = { errors: gpu.errors, failures: failures.map(String) }
  if (!image) {
    view.dispose()
    scene.dispose()
    surfaces.dispose()
    destroyRetired(device)
    return { ...base, adapter: (await gpu.fermer()).court, valid: false as const }
  }

  const { buffers, nodes } = view.record!
  const { tiles } = buffers
  const caps = gpuCapsOf(device)
  const wide = caps.wideAtomics
  const grid = hairTileGrid(WIDTH, HEIGHT)
  const counters = (await readGpuBuffer(device, nodes.nodeCounter, HAIR_NODE_COUNTERS * 4))!
  const placed = counters[HAIR_NODE_COUNTER_STORED]!
  const read: Readbacks = {
    wide,
    samples: (await readGpuBuffer(
      device,
      buffers.bands[0]!.samples,
      WIDTH * HEIGHT * SAMPLES * 8,
    ))!,
    transmittance: insideTiles(
      (await readGpuTextureR32F(device, image.transmittance, WIDTH, HEIGHT))!,
      view.tileRect,
    ),
    tiles: { x: grid.x, y: grid.y, capacity: tiles.capacity },
    tileCounts: (await readGpuBuffer(device, tiles.counts, HAIR_TILE_LISTS * 4))!,
    tileLists: (await readGpuBuffer(device, tiles.data, HAIR_TILE_LISTS * tiles.capacity * 4))!,
    drawArgs: (await readGpuBuffer(
      device,
      tiles.drawArgs,
      HAIR_TILE_LISTS * HAIR_DRAW_ARGS_WORDS * 4,
    ))!,
    dispatchArgs: (await readGpuBuffer(
      device,
      tiles.dispatchArgs,
      HAIR_TILE_LISTS * HAIR_DISPATCH_ARGS_WORDS * 4,
    ))!,
    descriptors: new Uint32Array(
      (await readGpuImage(device, image.nodeIndex, WIDTH, HEIGHT, undefined, { topDown: true }))
        .buffer,
    ),
    coverage: (await readGpuTextureR32F(device, image.coverage, WIDTH, HEIGHT))!,
    placed,
    nodeVis: (await readGpuBuffer(device, nodes.nodeVis, Math.max(placed, 1) * HAIR_SAMPLE_BYTES))!,
    nodeCoord: (await readGpuBuffer(device, nodes.nodeCoord, Math.max(placed, 1) * 4))!,
    nodeArgs: (await readGpuBuffer(device, nodes.nodeArgs, HAIR_DISPATCH_ARGS_WORDS * 4))!,
    nodeData: (await readGpuBuffer(
      device,
      nodes.nodeData,
      Math.max(placed, 1) * HAIR_NODE_DATA_WORDS * 4,
    ))!,
    hairOnlyDepth: (await readGpuTextureR32F(device, image.hairOnlyDepth, WIDTH, HEIGHT))!,
    depth: (await readGpuTextureR32F(device, depth, WIDTH, HEIGHT))!,
    flags: new Uint32Array(
      (await readGpuImage(device, surfaces.words, WIDTH, HEIGHT, undefined, { topDown: true }))
        .buffer,
    ),
    depthBefore: input.occluder ? 0.5 : 0,
    flagsBefore: LIT_FLAGS,
  }
  const form = closedForm(cam)
  const result = {
    ...base,
    valid: true as const,
    wide,
    blendable: caps.float32Blendable,
    samples: checkSamples(read, form, ribbons, input.occluder),
    runs: checkRuns(read),
    transmittance: checkTransmittance(read, form, ribbons, input.occluder),
    tiles: checkTiles(read),
    compaction: checkCompaction(read),
    material: checkMaterial(read, ribbons, flags),
    gbuffer: checkGbuffer(read, true),
    placed,
    allocated: counters[HAIR_NODE_COUNTER_PLACED]!,
  }
  view.dispose()
  scene.dispose()
  surfaces.dispose()
  destroyRetired(device)
  return { ...result, adapter: (await gpu.fermer()).court }
}
