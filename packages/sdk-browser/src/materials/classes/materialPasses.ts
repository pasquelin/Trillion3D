import { shadeColorAttachments } from '../../frame/prepare/attachments.ts'
import { followEmissiveAo } from '../../frame/prepare/emissiveAoLayer.ts'
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import { rowsUnread } from '../../geometry/rows/dirty.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { type PresentClasses, markPresentClasses } from '../../gpu/core/presentClasses.ts'
import { MATERIAL_COMPUTE_PASS, MATERIAL_SURFACES_PASS } from '../../diagnostic/stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SHADING_RULES } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { shadeBinningQuads } from './shadeBins.ts'

/** The shading's setting `field` the session holds (`shadingOptions.ts`), by its one resolver,
 *  read at each image. */
const shadingSetting = contextReader(SHADING_RULES)

/** The material pass's compute pass: the frame's cache, the shading bins and the classes' shading. */
const materialPass = new LazyComputePass(MATERIAL_COMPUTE_PASS)

export const createPresentClasses = (): PresentClasses => ({
  stamps: new Uint32Array(MATERIAL_CLASS_KEYS),
  keys: [],
  stamp: 0,
  read: rowsUnread(),
})

/**
 * Surfaces of the opaque image, shaded in compute as the reference shades them. The surfaces and
 * the feedback target are cleared first, by a pass of no draw: the background keeps the clear.
 * Then one compute pass: what many pixels compute alike, once (`../../visibility/passes/shadeCache.ts`);
 * the shading bins, every pixel sorted by its class (`shadeBins.ts`), by pixel or by quad as the
 * `shadeBinningMode` setting asks (`shadeBinningQuads`); and each class of the image's rows shades
 * the pixels of its bin alone, one indirect dispatch a class, storing them in the surfaces. Each
 * class was compiled before this image: the scene's at preparation, one a material changed into
 * since at the frame entry that held the image on it (`../../frame/loop/framePipelines.ts`).
 */
export function encodeMaterialPasses(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    { rows } = rt.layout,
    [width, height] = gpu.targetSize
  // The image checked its pipelines, table and surfaces before encoding; what the resolve adds is
  // its bind group, its bins and its classes, and it fails by name without them.
  const bins = vis.shadeBins
  if (!vis.shadeBindGroup || !vis.shadeClasses || !bins)
    throw new Error('MATERIAL_RESOLVE_UNAVAILABLE')
  const keys = markPresentClasses(
    rows.pageTableInts!,
    rows.packedCount,
    vis.presentClasses,
    rows.rowWrites,
  )
  // Its rows are written: one that came to emit or occlude brings the layer before this resolve.
  followEmissiveAo(rt)
  // Read after the layer was followed: a surface that came to emit switched the classes and the
  // surfaces.
  const classes = vis.shadeClasses,
    surfaces = gpu.surfaces!
  encoder
    .beginRenderPass({
      label: MATERIAL_SURFACES_PASS,
      colorAttachments: shadeColorAttachments(rt, surfaces),
    })
    .end()
  const pass = materialPass.begin(encoder)
  vis.shadeCache?.encode(pass, {
    vis: vis.visView!,
    pages: vis.pageTable!,
    indices: gpu.cache!.buffer,
    positions: vis.concatPos!,
    uvs: vis.concatUv!,
    normals: vis.concatNrm!,
    uniform: vis.shadeUniform!,
    material: vis.materialTable.view!,
  })
  if (keys.length) {
    bins.assign(keys, shadeBinningQuads(shadingSetting(rt, 'shadeBinningMode')))
    bins.layFor(width, height)
    run.gpuComputeDispatches += bins.encode(
      pass,
      vis.visView!,
      vis.pageTable!,
      vis.shadeUniform!,
      width,
      height,
    )
    const shading = pass.pass,
      feedback = vis.writesFeedback ? gpu.feedbackView : undefined
    shading.setBindGroup(0, vis.shadeBindGroup)
    shading.setBindGroup(1, bins.outputs(surfaces, feedback))
    for (let at = 0; at < keys.length; at++) {
      shading.setPipeline(classes.of(keys[at]).get())
      bins.dispatch(shading, at)
    }
    run.gpuComputeDispatches += keys.length
  }
  pass.end()
}
