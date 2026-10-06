import { shadeColorAttachments } from '../pages/prepare/attachments.ts'
import { followEmissiveAo } from '../pages/prepare/emissiveAoLayer.ts'
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import { rowsUnread } from '../row/dirty.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { type PresentClasses, markPresentClasses } from './presentClasses.ts'
import { MATERIAL_COMPUTE_PASS, MATERIAL_SURFACES_PASS } from '../../stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'

/** The resolve's compute pass, opened by the first of its modules that dispatches. */
const materialPass = new LazyComputePass(MATERIAL_COMPUTE_PASS)

export const createPresentClasses = (): PresentClasses => ({
  stamps: new Uint32Array(MATERIAL_CLASS_KEYS),
  keys: [],
  stamp: 0,
  read: rowsUnread(),
})

/**
 * Surfaces of the opaque image. A prepared one-class scene shades directly. Otherwise the material
 * tiles list the screen tiles each class holds (`materialTiles.ts`), then each class draws its
 * tiles. Either way a class's fragment stage rejects, before any write, a pixel of the background,
 * past the page table or of another class (`classAdmits`): what a material depth tested `equal`
 * at the class's depth keeps, without its target or its pass. The surfaces and feedback
 * target are cleared once and then kept.
 */
export function encodeMaterialPasses(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    { rows } = rt.layout,
    [width, height] = gpu.targetSize
  // The image checked its pipelines, table and surfaces before encoding; what the resolve adds is
  // its bind group, its tiles and its classes, and it fails by name without them.
  const tiles = vis.materialTiles
  if (!vis.shadeBindGroup || !vis.shadeClasses || !tiles)
    throw new Error('MATERIAL_RESOLVE_UNAVAILABLE')
  const keys = markPresentClasses(
    rows.pageTableInts!,
    rows.packedCount,
    vis.presentClasses,
    rows.rowWrites,
  )
  // Its rows are written: one that came to emit or occlude brings the layer before this resolve.
  followEmissiveAo(rt)
  // Read after the layer was followed: a surface that came to emit switched the classes.
  const classes = vis.shadeClasses
  const key = keys.length === 1 ? keys[0] : undefined,
    direct = key === undefined ? undefined : classes.single(key)
  // Compiled before this image, never by it: until it is, the tiles draw the class.
  const singlePipeline = direct?.ready ? direct.get() : undefined
  let tileGroup: GPUBindGroup | undefined
  if (!singlePipeline) {
    tiles.assign(keys)
    tileGroup = tiles.layFor(width, height)
  }
  // What many pixels computed alike, computed once (`../visibility/shadeCache.ts`), and the
  // classification of the tiles: one compute pass, opened only when one of them dispatches.
  const pass = materialPass.begin(encoder)
  vis.shadeCache?.encode(pass, {
    vis: vis.visView!,
    pages: vis.pageTable!,
    indices: gpu.cache!.buffer,
    positions: vis.concatPos!,
    uvs: vis.concatUv!,
    normals: vis.concatNrm!,
    uniform: vis.shadeUniform!,
  })
  if (tileGroup)
    tiles.encode(pass, { vis: vis.visView!, pages: vis.pageTable!, uniform: vis.shadeUniform! })
  pass.end()
  const shadePass = encoder.beginRenderPass({
    label: MATERIAL_SURFACES_PASS,
    colorAttachments: shadeColorAttachments(rt, gpu.surfaces!),
  })
  shadePass.setViewport(0, 0, width, height, 0, 1)
  shadePass.setBindGroup(0, vis.shadeBindGroup)
  if (tileGroup) shadePass.setBindGroup(1, tileGroup)
  for (let at = 0; at < keys.length; at++) {
    // Each class was compiled before this image: the scene's at preparation, one a material
    // changed into since at the frame entry that held the image on it
    // (`../frame/framePipelines.ts`).
    shadePass.setPipeline(singlePipeline ?? classes.of(keys[at]).get())
    if (singlePipeline) shadePass.draw(3)
    else tiles.draw(shadePass, at)
  }
  shadePass.end()
  run.gpuDrawCalls += keys.length
}
