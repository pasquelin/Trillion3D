import { shadeColorAttachments } from '../../frame/prepare/attachments.ts'
import { followEmissiveAo } from '../../frame/prepare/emissiveAoLayer.ts'
import { closureClears } from '../surface/closureClear.ts'
import { encodeClosureTiles } from '../../visibility/closureTiles/closureTiles.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { presentClassKeys } from '../../gpu/core/presentClasses.ts'
import { readsTime } from '../graph/surfaceClasses.ts'
import { isTimedApart } from '../../gpu/core/timedEncoder.ts'
import {
  MATERIAL_BINS_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SHADING_PASS_PREFIX,
  MATERIAL_SURFACES_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { readShadingSetting } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { shadeBinningQuads } from './shadeBins.ts'
import { displacedGroup, displacedKeys } from '../../visibility/tessellation/prismFrame.ts'

/** The material pass's compute pass: the shading bins and the classes' shading. */
const materialPass = new LazyComputePass(MATERIAL_COMPUTE_PASS)

/** The clear of the surfaces, held: its attachments are the image's. */
const SURFACES: GPURenderPassDescriptor = { label: MATERIAL_SURFACES_PASS, colorAttachments: [] }

/** The bins' pass of the detail (`gpuTimingDetail`), held. */
const BINS_DETAIL: GPUComputePassDescriptor = { label: MATERIAL_BINS_PASS }

/** The shading pass of each class of the detail, by class key: its label is made once. */
const shadingDetail = new Map<number, GPUComputePassDescriptor>()
const shadingDetailOf = (key: number) => {
  let descriptor = shadingDetail.get(key)
  if (!descriptor)
    shadingDetail.set(key, (descriptor = { label: MATERIAL_SHADING_PASS_PREFIX + key }))
  return descriptor
}

/** One indirect dispatch a class of the image over its bin, in `shading` — or, given `apart`, in a
 *  compute pass of its own on that encoder, bound to `outputs`, so each class keeps its own timestamps.
 *  The classes that draw a displaced pixel read their own group 0 and pipeline (`prismFrame.ts`), the
 *  others the resolve's. */
function dispatchClasses(
  rt: WebgpuPagesRuntime,
  shading: GPUComputePassEncoder | undefined,
  keys: readonly number[],
  bins: NonNullable<WebgpuPagesRuntime['vis']['shadeBins']>,
  outputs: GPUBindGroup,
  apart?: GPUCommandEncoder,
) {
  const { gpu, vis } = rt,
    stage = readShadingSetting(rt, 'gpuShadeStage'),
    classes = stage ? vis.shadeClasses!.staged(stage) : vis.shadeClasses!
  const displaced = displacedKeys(rt),
    tessellates = displaced.length > 0
  let group: GPUBindGroup | undefined
  for (let at = 0; at < keys.length; at++) {
    const place = tessellates && displaced.includes(keys[at]!)
    const wanted = place ? displacedGroup(rt, gpu.device!) : vis.shadeBindGroup
    const pipeline = (place ? classes.displaced(keys[at]!) : classes.of(keys[at]!)).get()
    if (!pipeline) continue
    const pass = apart ? apart.beginComputePass(shadingDetailOf(keys[at]!)) : shading!
    if (apart) {
      pass.setBindGroup(1, outputs)
      group = undefined
    }
    if (wanted !== group) pass.setBindGroup(0, (group = wanted))
    pass.setPipeline(pipeline)
    bins.dispatch(pass, at)
    if (apart) pass.end()
  }
}

/**
 * Surfaces of the opaque image, shaded in compute as the reference shades them. The surfaces and
 * the feedback target are cleared first, by a pass of no draw: the background keeps the clear.
 * Then one compute pass: the shading bins, every pixel sorted by its class (`shadeBins.ts`) from
 * the shading masks the depth export wrote (`../../visibility/raster/exportWgsl.ts`), by pixel
 * or by quad as the `shadeBinningMode` setting asks (`shadeBinningQuads`); and each class of the
 * image's clusters shades the pixels of its bin alone — each decoding and transforming its own
 * triangle —, one indirect dispatch a class, storing them in the surfaces. Each
 * class was compiled before this image: the scene's at preparation, an object's before it joins the
 * session (`../../placement/append/classGate.ts`), one a material changed into since at the frame
 * entry, which holds the image for it (`../../frame/loop/framePipelines.ts`). `dispatchClasses`
 * skips a class that is not: one whose compile the device refused, its surfaces left unshaded.
 * On a frame sampled for the GPU timing with `gpuTimingDetail` set, the bins are one pass and each
 * class's shading a pass of its own, so each is timed apart; the image is the same.
 */
export function encodeMaterialPasses(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    [width, height] = gpu.targetSize
  // The image checked its pipelines, table and surfaces before encoding; what the resolve adds is
  // its bind group, its bins and its classes, and it fails by name without them.
  const bins = vis.shadeBins,
    mask = vis.gpuRaster?.shadingMask
  if (!vis.shadeBindGroup || !vis.shadeClasses || !bins || !mask)
    throw new Error('MATERIAL_RESOLVE_UNAVAILABLE')
  // The classes the resident clusters wear, counted as their records are written.
  const keys = presentClassKeys(vis.presentClasses)
  vis.graphsAnimated = readsTime(keys)
  // Its clusters' records are written: one that came to emit or occlude brings the layer before this resolve.
  followEmissiveAo(rt)
  // Read after the layer was followed: a surface that came to emit switched the classes
  // (`dispatchClasses` reads them) and the surfaces.
  const surfaces = gpu.surfaces!
  SURFACES.colorAttachments = shadeColorAttachments(rt, surfaces)
  encoder.beginRenderPass(SURFACES).end()
  // A record of several closures clears its closure slices beside (`closureClears`).
  for (const clear of closureClears(surfaces)) encoder.beginRenderPass(clear).end()
  const pass = materialPass.begin(encoder)
  if (keys.length) {
    const apart = isTimedApart(encoder)
    bins.assign(keys, shadeBinningQuads(readShadingSetting(rt, 'shadeBinningMode')))
    bins.layFor(width, height)
    const feedback = vis.writesFeedback ? gpu.feedbackView : undefined
    if (apart) {
      const binning = encoder.beginComputePass(BINS_DETAIL)
      run.gpuComputeDispatches += bins.encode({ pass: binning }, mask, width, height)
      binning.end()
      dispatchClasses(rt, undefined, keys, bins, bins.outputs(surfaces, feedback), encoder)
    } else {
      run.gpuComputeDispatches += bins.encode(pass, mask, width, height)
      const shading = pass.pass
      const outputs = bins.outputs(surfaces, feedback)
      shading.setBindGroup(1, outputs)
      dispatchClasses(rt, shading, keys, bins, outputs)
    }
    run.gpuComputeDispatches += keys.length
  }
  pass.end()
  // A record of several closures lists the tiles that hold them (`closureTiles.ts`).
  encodeClosureTiles(rt, encoder)
}
