import { gpuCapsOf } from '../gpu/core/gpuCaps.ts'
import {
  clearHairNodes,
  compactionPipelines,
  encodeHairCompaction,
  encodeHairNodeArgs,
} from './compactionPass.ts'
import { encodeHairDepth, encodeHairGbuffer, gbufferPipelines } from './gbufferPass.ts'
import { encodeHairMaterial, materialPipelines } from './materialPass.ts'
import { coverageMapPipelines, encodeCoverageMapping } from './coverageMapPass.ts'
import { encodeHairDeepShadows } from './deepShadowPass.ts'
import { encodeHairVoxels } from './voxelPass.ts'
import { encodeHairMsaa, msaaPipelines } from './msaaPass.ts'
import { RENDER_CURVE_SEGMENT_BYTES, renderCurveCommon } from './renderCurve/renderCurveMath.ts'
import { encodeHairForward } from './forward/forwardVisibility.ts'
import { forwardNodeCount } from './forward/forwardMath.ts'
import { encodeHairClearSamples, encodeHairRaster, rasterPipelines } from './rasterPass.ts'
import { ensureHairBinned, sendHairBinnedParams } from './binnedRasterPass.ts'
import {
  HAIR_RASTER_DEFAULTS,
  hairRasterGeometry,
  hairRasterPlan,
  hairRasterPlanKey,
  type HairRasterPlan,
} from './rasterModes.ts'
import { storageBufferCap } from '../session/memory/pools.ts'
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
interface HairProgramsCommon {
  readonly samples: HairSampleCount
  readonly wide: boolean
  readonly blendable: boolean
  readonly sorted: boolean
  readonly patch: boolean
  readonly mapped: boolean
  /** What picks the compute raster's passes (`hairRasterPlanKey`). */
  readonly planKey: string
  readonly tiles: NonNullable<ReturnType<typeof tilePipelines>>
  readonly compact: NonNullable<ReturnType<typeof compactionPipelines>>
  readonly material: NonNullable<ReturnType<typeof materialPipelines>>
}

/** What the visibility samples' images need and the forward raster does not (it has its own passes). */
interface HairProgramsSampled {
  readonly forward: false
  readonly transmit: NonNullable<ReturnType<typeof transmittancePipelines>>
  readonly gbuffer: NonNullable<ReturnType<typeof gbufferPipelines>>
  /** The count of the strands of a pixel and its map to the transmittance, with `mapped`. */
  readonly coverageMap?: NonNullable<ReturnType<typeof coverageMapPipelines>>
}

/** The programs of an image drawn by the visibility samples, with the device's rasterizer writing them (`msaa`) or a compute raster doing it
 *  (`raster`). */
export type HairSampledPrograms = HairProgramsCommon &
  HairProgramsSampled &
  (
    | { readonly hardware: true; readonly msaa: NonNullable<ReturnType<typeof msaaPipelines>> }
    | { readonly hardware: false; readonly raster: NonNullable<ReturnType<typeof rasterPipelines>> }
  )

/** The programs: those of the visibility samples, or of the forward raster, which compiles and holds none of the raster's, the transmittance's,
 *  the surfaces' or the coverage map's. */
export type HairPrograms =
  HairSampledPrograms | (HairProgramsCommon & { readonly forward: true; readonly hardware: false })

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
  hardware: boolean,
  mapped: boolean,
  forward: boolean,
  plan: HairRasterPlan,
): HairPrograms | undefined {
  const caps = gpuCapsOf(device)
  const planKey = hairRasterPlanKey(plan)
  const wide = caps.wideAtomics,
    blendable = caps.float32Blendable
  const held = gpu.programs
  if (
    held &&
    held.forward === forward &&
    held.samples === samples &&
    held.wide === wide &&
    held.blendable === blendable &&
    held.sorted === sorted &&
    held.patch === patch &&
    held.mapped === mapped &&
    held.planKey === planKey &&
    held.hardware === hardware
  )
    return held
  const tiles = tilePipelines(device)
  const compact = compactionPipelines(device, samples, wide)
  const material = materialPipelines(device, sorted)
  if (!tiles || !compact || !material) return undefined
  const common = {
    samples,
    wide,
    blendable,
    sorted,
    patch,
    mapped,
    planKey,
    tiles,
    compact,
    material,
  }
  if (forward) return (gpu.programs = { ...common, forward: true, hardware: false })
  const transmit = transmittancePipelines(device, blendable)
  const raster = hardware ? undefined : rasterPipelines(device, samples, wide, plan)
  const msaa = hardware ? msaaPipelines(device, samples, wide) : undefined
  const gbuffer = gbufferPipelines(device, patch)
  const coverageMap = mapped ? coverageMapPipelines(device) : undefined
  if (!transmit || !gbuffer || (mapped && !coverageMap)) return undefined
  const sampled = { ...common, forward: false as const, transmit, gbuffer, coverageMap }
  if (msaa) return (gpu.programs = { ...sampled, hardware: true, msaa })
  if (raster) return (gpu.programs = { ...sampled, hardware: false, raster })
  return undefined
}

/** The resources of the compute raster for this image, kept or made, with the image's parameters written; none where the device refuses them
 *  (`fail` is told once). */
function ensureRasterBinned(
  device: GPUDevice,
  gpu: HairViewGpu,
  plan: HairRasterPlan,
  fail: (error: unknown) => void,
) {
  const { inputs, members } = gpu
  const points = members.reduce((most, { group }) => Math.max(most, group.pointCount), 0)
  const geometry = hairRasterGeometry(
    inputs.raster ?? HAIR_RASTER_DEFAULTS,
    plan,
    inputs.size,
    points,
    storageBufferCap(device.limits),
  )
  const { resources, why } = ensureHairBinned(gpu.binned, device, geometry, plan)
  gpu.binned = resources
  if (!resources) tellHairOnce(gpu, 'raster', why ?? 'no room for the raster', fail)
  else sendHairBinnedParams(device, resources, plan, inputs.size)
  return resources
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
  // The forward raster keeps no sample a pixel (the least count holds the unused bands) and has a sample for each control point.
  const forward = !!inputs.forwardRaster
  const samples = forward ? 2 : hairSampleCount(inputs.samplesPerPixel)
  const plan = hairRasterPlan(inputs.raster ?? HAIR_RASTER_DEFAULTS)
  const mean = hairMeanSampleCount(samples, inputs.meanSamplesPerPixel)
  const programs = programsFor(
    device,
    gpu,
    samples,
    inputs.sortByDepth,
    !!inputs.surfaces,
    !!inputs.hardwareRaster && !forward,
    !!inputs.coverageMapping && !forward,
    forward,
    plan,
  )
  if (!programs) return undefined
  if (
    !programs.forward &&
    !programs.hardware &&
    !ensureRasterBinned(device, gpu, programs.raster.plan, fail)
  )
    return undefined
  for (const member of members) if (!member.group.tangentsWritten) return undefined
  const asked = forward ? forwardNodeCount(members) : hairNodeCapacity(rect, mean)
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
      hardware: programs.hardware,
      mapped: programs.mapped,
      forward: programs.forward,
      needed: Math.min(asked, HAIR_NODE_ROOM_MAX),
    },
    fail,
  )
}

/** The least radii of a strand, for the image: written in place each image. */
const radii: [number, number, number, number] = [0, 0, 0, 0]

/** The view's block: the strands never thinner than the samples of a pixel can find, over the view-projection with the image's jitter. */
function writeViewBlock(gpu: HairViewGpu, record: HairViewRecord) {
  const { inputs } = gpu
  const { camera, size } = inputs
  const { samples } = record
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
    !!inputs.forwardRaster,
  )
  gpu.viewBlock.send()
}

/** The image's block. */
function writeImageBlock(gpu: HairViewGpu, record: HairViewRecord) {
  const { inputs, imageBlock, tileRect } = gpu
  const { size } = inputs
  const { needed, buffers } = record
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
  u[9] = inputs.hardwareRaster && !inputs.forwardRaster ? 1 : 0
  imageBlock.send()
}

/** Each drawn instance's block. */
function writeInstanceBlocks(device: GPUDevice, gpu: HairViewGpu) {
  const { inputs } = gpu
  const { drawn, members } = gpu
  drawn.length = 0
  for (let material = 0; material < members.length; material++) {
    const instance = members[material]!
    const held = instanceGpu(device, gpu, instance)
    writeHairInstanceBlock(
      held.block.words,
      instance,
      inputs.camera.eye,
      material,
      gpu.macroGroups[material]!,
      inputs.flags,
    )
    held.block.send()
    drawn.push(held.drawn)
  }
}

/** The instances the voxels and the deep shadows are made of: the drawn ones, and those only their shadow is cast by, each group's apart. */
function writeGroupInstances(
  device: GPUDevice,
  gpu: HairViewGpu,
  macroGroups: readonly MacroGroup<HairInstance>[],
) {
  const { inputs, drawn, members } = gpu
  const { camera } = inputs
  const { voxelDrawn, groupInstances } = gpu
  voxelDrawn.length = 0
  for (const list of groupInstances) list.length = 0
  if (!inputs.surfaces || !(inputs.voxel || inputs.deepShadow)) return
  for (let rank = 0; rank < macroGroups.length; rank++) {
    const list = (groupInstances[rank] ??= [])
    for (const instance of macroGroups[rank]!.shadowMembers) {
      const held = instanceGpu(device, gpu, instance)
      writeHairInstanceBlock(held.block.words, instance, camera.eye, 0, rank, inputs.flags)
      held.block.send()
      list.push(held.drawn)
      if (instance.supportsVoxelization) voxelDrawn.push(held.drawn)
    }
  }
  for (let material = 0; material < members.length; material++) {
    groupInstances[gpu.macroGroups[material]!]!.push(drawn[material]!)
    if (members[material]!.supportsVoxelization) voxelDrawn.push(drawn[material]!)
  }
}

/**
 * Writes the blocks of the image, only the words that changed: the view's (strands never thinner than
 * the samples of a pixel can find, which the transmittance — one sample a pixel — and the visibility —
 * its count — see differently, each at the width of a groom drawn stable too, over the view-projection
 * with the image's jitter, the eye at the origin, and its inverse), the image's, each instance's and
 * each band's window.
 */
function writeBlocks(
  device: GPUDevice,
  gpu: HairViewGpu,
  record: HairViewRecord,
  macroGroups: readonly MacroGroup<HairInstance>[],
) {
  writeViewBlock(gpu, record)
  writeImageBlock(gpu, record)
  writeInstanceBlocks(device, gpu)
  writeHairWindows(device, record.buffers, gpu.inputs.size[0], gpu.inputs.size[1])
  writeGroupInstances(device, gpu, macroGroups)
}

/** The volumes the light is traced through once the strands are lit: the voxels, and the deep shadows of the lights that draw one. */
function encodeVolumes(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  macroGroups: readonly MacroGroup<HairInstance>[],
  depthView: GPUTextureView,
  fail: (error: unknown) => void,
) {
  const { inputs } = gpu
  // The strands are summed into the voxel volume the light is traced through once they are lit (the
  // surfaces are handed to the lighting); else no volume is held.
  if (inputs.voxel && inputs.surfaces)
    encodeHairVoxels(device, encoder, gpu.voxel, {
      settings: inputs.voxel,
      macroGroups,
      bounds: gpu.bounds,
      eye: inputs.camera.eye,
      instances: gpu.voxelDrawn,
      viewBuffer: gpu.viewBlock.buffer,
      depthView,
      fail,
    })
  else gpu.voxel.dispose()
  // The lights that draw a deep shadow draw it, once the strands are lit.
  gpu.deepShadows =
    inputs.deepShadow && inputs.surfaces
      ? encodeHairDeepShadows(device, encoder, gpu.deepShadow, {
          settings: inputs.deepShadow.settings,
          lights: inputs.deepShadow.lights,
          macroGroups,
          groupInstances: gpu.groupInstances,
          bounds: gpu.bounds,
          viewBuffer: gpu.viewBlock.buffer,
          renderSize: inputs.size,
          fail,
        })
      : undefined
  if (!gpu.deepShadows) gpu.deepShadow.dispose()
}

/** The material of the compacted samples and the surfaces' buffers they write, in the open compute pass. */
function encodeShading(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  gpu: HairViewGpu,
  { targets, buffers, nodes }: HairViewRecord,
  programs: HairSampledPrograms,
) {
  const { inputs, drawn } = gpu
  const { tiles } = buffers
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
}

/** The visibility samples drawn: by the device's rasterizer, in passes of its own between two compute passes (the second returned), or by the compute raster in the open pass. */
function encodeVisibilitySamples(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  { targets, buffers }: HairViewRecord,
  programs: HairSampledPrograms,
  pass: GPUComputePassEncoder,
  compute: () => GPUComputePassEncoder,
) {
  const { inputs, imageBlock, drawn, rect } = gpu
  const depthView = inputs.depthView!
  if (!programs.hardware) {
    encodeHairRaster(device, pass, programs.raster, buffers.raster, depthView, drawn, gpu.binned!)
    return pass
  }
  pass.end()
  encodeHairMsaa(
    device,
    encoder,
    programs.msaa,
    targets.msaa!,
    {
      viewBuffer: gpu.viewBlock.buffer,
      depthView,
      image: imageBlock.buffer,
      size: inputs.size,
      rect,
    },
    drawn,
    buffers.tiles,
    buffers.bands,
    buffers.raster.count,
  )
  return compute()
}

/** The tiles the strands touch, the clear of their samples, the visibility samples, their compaction, their material and the depth of the nearest strand of each pixel, in compute passes. */
function encodeSamples(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  record: HairViewRecord,
  programs: HairSampledPrograms,
) {
  const { inputs, tileRect, imageBlock } = gpu
  const depthView = inputs.depthView!
  const { targets, buffers, nodes } = record
  const { tiles } = buffers
  const compute = () => encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}visibility` })
  let pass = compute()
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
    (programs.hardware ? programs.msaa : programs.raster).clear,
    buffers.raster,
    imageBlock.buffer,
    tiles,
  )
  pass = encodeVisibilitySamples(device, encoder, gpu, record, programs, pass, compute)
  for (let k = 0; k < buffers.raster.count; k++) {
    const band = buffers.bands[k]!
    encodeHairCompaction(
      pass,
      programs.compact,
      band.compact(device, programs.compact.compact, record.compaction, band, nodes, depthView),
      tiles,
    )
  }
  encodeShading(device, pass, gpu, record, programs)
  pass.end()
}

/** The transmittance of the ribbons, the coverage count of the pixels, then the samples, their compaction and their material. */
function encodeSampledVisibility(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  record: HairViewRecord,
  programs: HairSampledPrograms,
) {
  const { inputs, rect, tileRect, imageBlock, drawn } = gpu
  const depthView = inputs.depthView!
  const { targets } = record
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
  if (programs.coverageMap && targets.counts)
    encodeCoverageMapping(
      device,
      encoder,
      programs.coverageMap,
      targets.mapBinds,
      targets.counts,
      {
        viewBuffer: gpu.viewBlock.buffer,
        depthView,
        image: imageBlock.buffer,
        transmittance: targets.transmittanceView,
        size: inputs.size,
        rect,
        tiles: tileRect,
      },
      drawn,
    )
  encodeSamples(device, encoder, gpu, record, programs)
}

/** The curve raster, which reads the scene's depth before the strands write theirs: in every mode, it is the scene's, not the strands'. */
function encodeCurveRaster(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  gpu: HairViewGpu,
  depthView: GPUTextureView,
) {
  const { inputs } = gpu
  if (!inputs.renderCurve) return gpu.renderCurve.release()
  gpu.renderCurve.encode(
    encoder,
    renderCurveCommon(
      inputs.size[0],
      inputs.size[1],
      inputs.renderCurve.binners,
      inputs.renderCurve.rasterizers,
      inputs.renderCurve.minCoverage,
      storageBufferCap(device.limits) / RENDER_CURVE_SEGMENT_BYTES,
    ),
    depthView,
    {
      scene: gpu.scene,
      viewProjection: inputs.viewProjection,
      projection: inputs.camera.projection,
      perspective: inputs.camera.perspective !== 0,
      eye: inputs.camera.eye,
    },
  )
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
  // The curve raster is the scene's, not the strands': it runs whatever they show, and reads the scene's depth before they write theirs.
  if (gpu.inputs.depthView) encodeCurveRaster(device, encoder, gpu, gpu.inputs.depthView)
  const record = acquire(device, gpu, macroGroups, fail)
  if (!record) return undefined
  const programs = gpu.programs!
  const { inputs, rect, tileRect } = gpu
  const depthView = inputs.depthView!
  const { targets, buffers, nodes } = record
  const { tiles } = buffers
  hairTileRect(tileRect, rect)
  writeBlocks(device, gpu, record, macroGroups)
  encodeVolumes(device, encoder, gpu, macroGroups, depthView, fail)
  // What the passes fill starts empty: the counters first, outside any pass; the samples are emptied
  // where the tiles say they will be read.
  clearHairTiles(encoder, tiles)
  clearHairNodes(encoder, nodes)
  if (programs.forward) {
    if (!encodeHairForward(device, encoder, gpu, record, programs, fail)) return undefined
  } else {
    encodeSampledVisibility(device, encoder, gpu, record, programs)
  }
  if (programs.forward) {
    // The forward raster patches no surface, and writes no per-pixel descriptor the custom depth reads: no strand renders custom depth in its image.
    gpu.customDepth.release()
  } else {
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
    if (inputs.customDepthCoverage !== undefined)
      gpu.customDepth.encode(
        device,
        encoder,
        tiles,
        nodes,
        targets,
        inputs.size,
        inputs.customDepthCoverage,
      )
    else gpu.customDepth.release()
  }
  gpu.visible = record.view
  return record.view
}
