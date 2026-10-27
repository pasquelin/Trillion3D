import { gpuCapsOf } from '../gpu/core/gpuCaps.ts'
import {
  clearHairNodes,
  compactionPipelines,
  encodeHairCompaction,
  encodeHairNodeArgs,
} from './compactionPass.ts'
import { encodeHairDepth, encodeHairGbuffer, gbufferPipelines } from './gbufferPass.ts'
import { encodeHairMaterial, materialPipelines } from './materialPass.ts'
import { encodeHairClearSamples, encodeHairRaster, rasterPipelines } from './rasterPass.ts'
import { pixelSizeAtDepth1 } from './scene.ts'
import type { MacroGroup } from './macroGroups.ts'
import { clearHairTiles, encodeHairTiles, tilePipelines } from './tilesPass.ts'
import { encodeTransmittance, transmittancePipelines } from './transmittancePass.ts'
import { writeHairInstanceBlock, writeHairViewBlock, type HairRadii } from './visibilityBlocks.ts'
import {
  HAIR_MAX_DRAWN,
  HAIR_NODE_ROOM_MAX,
  hairMeanSampleCount,
  hairMinRadiusAtDepth1,
  hairNodeCapacity,
  hairSampleCount,
  hairTileRect,
  hairUnionRect,
  type HairSampleCount,
} from './visibilityMath.ts'
import {
  ensureHairResources,
  instanceGpu,
  tellHairOnce,
  writeHairWindows,
  type HairViewGpu,
  type HairViewRecord,
  type HairVisibilityView,
} from './viewGpu.ts'
import type { HairInstance } from './scene.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The programs of the image's passes, with what picks them. */
export interface HairPrograms {
  readonly samples: HairSampleCount
  readonly wide: boolean
  readonly blendable: boolean
  readonly sorted: boolean
  readonly patch: boolean
  readonly transmit: NonNullable<ReturnType<typeof transmittancePipelines>>
  readonly tiles: NonNullable<ReturnType<typeof tilePipelines>>
  readonly raster: NonNullable<ReturnType<typeof rasterPipelines>>
  readonly compact: NonNullable<ReturnType<typeof compactionPipelines>>
  readonly material: NonNullable<ReturnType<typeof materialPipelines>>
  readonly gbuffer: NonNullable<ReturnType<typeof gbufferPipelines>>
}

/** The programs for the image, none while one compiles. They are asked together (the frame is held
 *  until all are there) and then kept until what picks them moves: nothing is asked of the pipelines'
 *  tables, nor built, in an image that finds them kept. `patch`, the surfaces are handed to be
 *  patched under the strands. */
function programsFor(
  device: GPUDevice,
  gpu: HairViewGpu,
  samples: HairSampleCount,
  sorted: boolean,
  patch: boolean,
) {
  const caps = gpuCapsOf(device)
  const wide = caps.wideAtomics,
    blendable = caps.float32Blendable
  const held = gpu.programs
  if (
    held &&
    held.samples === samples &&
    held.wide === wide &&
    held.blendable === blendable &&
    held.sorted === sorted &&
    held.patch === patch
  )
    return held
  const transmit = transmittancePipelines(device, blendable)
  const tiles = tilePipelines(device)
  const raster = rasterPipelines(device, samples, wide)
  const compact = compactionPipelines(device, samples, wide)
  const material = materialPipelines(device, sorted)
  const gbuffer = gbufferPipelines(device, patch)
  if (!transmit || !tiles || !raster || !compact || !material || !gbuffer) return undefined
  return (gpu.programs = {
    samples,
    wide,
    blendable,
    sorted,
    patch,
    transmit,
    tiles,
    raster,
    compact,
    material,
    gbuffer,
  })
}

/**
 * Takes what an image of the strands needs, or nothing: the instances drawn (those the macro groups
 * hold that the view sees, each with the rank of its macro group, the first `HAIR_MAX_DRAWN` alone),
 * every program (all are asked at once, the frame is held until they are all there), and the
 * resources, made when the image asks for more than they hold, as their record. None when no pixel
 * holds a strand, a program is still compiling, a group's tangents are not written, or the device
 * cannot hold the buffers (`fail` is told once for a size).
 *
 * Two bounds are told once to `fail` and held: the instances past the materials a sample's identifier
 * names (`HAIR_MAX_DRAWN`) are not drawn, and the compacted samples past the ranks a pixel's descriptor
 * names (`HAIR_NODE_ROOM_MAX`) are not placed (the pixels whose lists find no room hold none), so that
 * neither wraps onto another's.
 */
function acquire(
  device: GPUDevice,
  gpu: HairViewGpu,
  macroGroups: readonly MacroGroup<HairInstance>[],
  fail: (error: unknown) => void,
) {
  const { inputs, members, rect } = gpu
  const { size, depthView } = inputs
  hairUnionRect(rect, macroGroups)
  members.length = gpu.macroGroups.length = 0
  for (let rank = 0; rank < macroGroups.length; rank++)
    for (const member of macroGroups[rank]!.members) {
      members.push(member)
      gpu.macroGroups.push(rank)
    }
  if (!depthView || !members.length || (rect[2] - rect[0]) * (rect[3] - rect[1]) <= 0)
    return undefined
  if (members.length > HAIR_MAX_DRAWN) {
    tellHairOnce(
      gpu,
      'instances',
      `${members.length} instances are visible, past the ${HAIR_MAX_DRAWN} a sample names: those past them are not drawn`,
      fail,
    )
    members.length = gpu.macroGroups.length = HAIR_MAX_DRAWN
  }
  const samples = hairSampleCount(inputs.samplesPerPixel)
  const mean = hairMeanSampleCount(samples, inputs.meanSamplesPerPixel)
  const programs = programsFor(device, gpu, samples, inputs.sortByDepth, !!inputs.surfaces)
  if (!programs) return undefined
  for (const member of members) if (!member.group.tangentsWritten) return undefined
  const asked = hairNodeCapacity(rect, mean)
  if (asked > HAIR_NODE_ROOM_MAX)
    tellHairOnce(
      gpu,
      'room',
      `the image asks room for ${asked} compacted samples, past the ${HAIR_NODE_ROOM_MAX} a pixel's descriptor names: the pixels past them hold none`,
      fail,
    )
  return ensureHairResources(
    device,
    gpu,
    {
      size,
      allocated: inputs.allocated,
      samples,
      blendable: programs.blendable,
      needed: Math.min(asked, HAIR_NODE_ROOM_MAX),
    },
    fail,
  )
}

/** The least radii of a strand, for the image: written in place each image. */
const radii: [number, number, number, number] = [0, 0, 0, 0]

/**
 * Writes the blocks of the image, only the words that changed: the view's (strands never thinner than
 * the samples of a pixel can find, which the transmittance — one sample a pixel — and the visibility —
 * its count — see differently, each at the width of a groom drawn stable too, over the view-projection
 * with the image's jitter, the eye at the origin, and its inverse), the image's, each instance's and
 * each band's window.
 */
function writeBlocks(device: GPUDevice, gpu: HairViewGpu, record: HairViewRecord) {
  const { inputs, imageBlock, tileRect } = gpu
  const { camera, size } = inputs
  const { samples, needed, buffers } = record
  const pixelSize = pixelSizeAtDepth1(
    camera.projection,
    camera.perspective,
    inputs.pixelSize[0],
    inputs.pixelSize[1],
  )
  radii[0] = hairMinRadiusAtDepth1(pixelSize, samples, inputs.rasterizationScale)
  radii[1] = hairMinRadiusAtDepth1(pixelSize, 1, inputs.rasterizationScale)
  radii[2] = hairMinRadiusAtDepth1(pixelSize, samples, inputs.stableRasterizationScale)
  radii[3] = hairMinRadiusAtDepth1(pixelSize, 1, inputs.stableRasterizationScale)
  writeHairViewBlock(
    gpu.viewBlock.words,
    inputs.viewProjection,
    inputs.inverseViewProjection,
    inputs.forward,
    camera.perspective === 0,
    radii as HairRadii,
    size[0],
    size[1],
    inputs.sortByDepth,
  )
  gpu.viewBlock.send()
  const { u, f } = imageBlock.words
  u[0] = size[0]
  u[1] = size[1]
  u[2] = tileRect[0]
  u[3] = tileRect[1]
  u[4] = buffers.tiles.capacity
  f[5] = inputs.fullCoverage
  u[6] = needed
  u[7] = inputs.sortByDepth ? 1 : 0
  u[8] = inputs.emissionLayer
  imageBlock.send()
  const { drawn, members } = gpu
  drawn.length = 0
  for (let material = 0; material < members.length; material++) {
    const instance = members[material]!
    const held = instanceGpu(device, gpu, instance)
    writeHairInstanceBlock(
      held.block.words,
      instance,
      camera.eye,
      material,
      gpu.macroGroups[material]!,
      inputs.flags,
    )
    held.block.send()
    drawn.push(held.drawn)
  }
  writeHairWindows(device, buffers, size[0], size[1])
}

/**
 * Encodes the strands' visibility of an image on `encoder`, after their bounds (`encodeHairScene`)
 * and the surfaces' depth: the transmittance of the ribbons over the opaque depth, then in one compute
 * pass the tiles it touches, the clear of the samples of those tiles, the visibility samples a compute
 * raster writes, their compaction, their material and the depth of the nearest strand of each pixel.
 * Where the surfaces are handed (`inputs.surfaces`, which the lighting of the strands hands: the
 * surfaces they cover wholly are theirs to light), the same walk empties those surfaces, and a pass
 * after writes their depth. `macroGroups` are the view's; the instances they draw are the material of
 * their identifiers, by their rank. Returns the strands of the image (also kept in `gpu.visible`), or
 * none when there is nothing to show — no strand on a pixel, a program still compiling (the frame is
 * held for it), or buffers the device cannot hold (`fail` is told once for a size).
 */
export function encodeHairVisibility(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  macroGroups: readonly MacroGroup<HairInstance>[],
  fail: (error: unknown) => void,
): HairVisibilityView | undefined {
  gpu.visible = undefined
  const record = acquire(device, gpu, macroGroups, fail)
  if (!record) return undefined
  const programs = gpu.programs!
  const { inputs, rect, tileRect, imageBlock, drawn } = gpu
  const depthView = inputs.depthView!
  const { targets, buffers, nodes } = record
  const { tiles } = buffers
  hairTileRect(tileRect, rect)
  writeBlocks(device, gpu, record)

  // What the passes fill starts empty: the counters first, outside any pass; the samples are emptied
  // where the tiles say they will be read.
  clearHairTiles(encoder, tiles)
  clearHairNodes(encoder, nodes)
  encodeTransmittance(
    device,
    encoder,
    programs.transmit,
    targets,
    {
      viewBuffer: gpu.viewBlock.buffer,
      depthView,
      image: imageBlock.buffer,
      size: inputs.size,
      rect,
      tiles: tileRect,
    },
    drawn,
  )
  const pass = encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}visibility` })
  encodeHairTiles(
    device,
    pass,
    programs.tiles,
    tiles,
    imageBlock.buffer,
    targets.transmittanceView,
    tileRect,
  )
  encodeHairClearSamples(
    device,
    pass,
    programs.raster.clear,
    buffers.raster,
    imageBlock.buffer,
    tiles,
  )
  encodeHairRaster(device, pass, programs.raster.phases, buffers.raster, depthView, drawn)
  for (let k = 0; k < buffers.raster.count; k++) {
    const band = buffers.bands[k]!
    encodeHairCompaction(
      pass,
      programs.compact,
      band.compact(device, programs.compact.compact, record.compaction, band, nodes, depthView),
      tiles,
    )
  }
  encodeHairNodeArgs(device, pass, programs.compact, nodes)
  encodeHairMaterial(
    device,
    pass,
    programs.material,
    gpu.materialBinds,
    nodes,
    drawn,
    tiles,
    targets.nodeIndexView,
  )
  encodeHairGbuffer(
    device,
    pass,
    programs.gbuffer,
    gpu.gbufferBinds,
    tiles,
    nodes,
    targets,
    inputs.surfaces,
  )
  pass.end()
  if (programs.gbuffer.depth) {
    // The surfaces the strands cover wholly were emptied: their depth becomes the strands'.
    gpu.depthPass.depthStencilAttachment.view = depthView
    const depth = encoder.beginRenderPass(gpu.depthPass)
    encodeHairDepth(
      device,
      depth,
      programs.gbuffer.depth,
      gpu.gbufferBinds,
      tiles,
      nodes,
      targets,
      inputs.size,
    )
    depth.end()
  }
  gpu.visible = record.view
  return record.view
}
