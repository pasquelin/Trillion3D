import { shadeColorAttachments } from '../pages/prepare/attachments.ts'
import { followEmissiveAo } from '../pages/prepare/emissiveAoLayer.ts'
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import { rowsUnread } from '../row/dirty.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { type PresentClasses, markPresentClasses } from './presentClasses.ts'
import { MATERIAL_COMPUTE_PASS, MATERIAL_SURFACES_PASS } from '../../stage/passLabels.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import type { RecordBundle } from '../../gpu/core/renderBundles.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import { shadeTargetFormats } from '../visibility/shadeTargets.ts'
import type { MaterialTiles } from './materialTiles.ts'
import type { ShadeClasses } from '../visibility/shadePipelines.ts'

/** The resolve's compute pass, opened by the first of its modules that dispatches. */
const materialPass = new LazyComputePass(MATERIAL_COMPUTE_PASS)

/** The surfaces pass's bundle layouts, by feedback target (2) and emission layer (1): its
 *  attachments' formats, the layer's slot empty while it is the 1×1 stand-in
 *  (`shadeColorAttachments`). */
const SURFACE_BUNDLES = [0, 1, 2, 3].map((at) => ({
  label: 'Trillion3D material classes',
  colorFormats: shadeTargetFormats(at >= 2).map((format, slot) =>
    slot === 2 && !(at & 1) ? null : format,
  ),
}))
const surfaceBundle = (rt: WebgpuPagesRuntime, surfaces: SurfaceBuffer) =>
  SURFACE_BUNDLES[(rt.vis.writesFeedback ? 2 : 0) + (surfaces.hasEmissiveAo === false ? 0 : 1)]

/** The surfaces bundle's key past its layout, in the order `encodeSurfaces` writes it. */
type ClassKey = [
  group: GPUBindGroup,
  tileGroup: GPUBindGroup | undefined,
  tiles: MaterialTiles | undefined,
  single: GPURenderPipeline | undefined,
  classes: ShadeClasses,
  stamp: number,
  keys: readonly number[],
]

/** Records the class draws a key names after its layout: the resolve's group, the tiles' group
 *  and the tiles, the sole class's direct pipeline, then the class set and the present classes'
 *  keys (after their stamp), each class's pipeline in slot order. */
const recordClasses: RecordBundle<ClassKey> = (encoder, key) => {
  const [, group, tileGroup, tiles, single, classes, , keys] = key
  encoder.setBindGroup(0, group)
  if (tileGroup) encoder.setBindGroup(1, tileGroup)
  if (single) {
    encoder.setPipeline(single)
    encoder.draw(3)
    return
  }
  // Each class was compiled before this image: the scene's at preparation, one a material
  // changed into since at the frame entry that held the image on it (`../frame/framePipelines.ts`).
  for (let at = 0; at < keys.length; at++) {
    encoder.setPipeline(classes.of(keys[at]).get())
    tiles!.draw(encoder, at)
  }
}

/**
 * The surfaces pass: each class of `keys` draws its tiles, or the sole class `single` full
 * screen, as the pass's render bundle (`rt.vis.shadeBundles`). The key is the groups, the tiles,
 * the class set and the present classes' stamp — moved only when their rows were walked again
 * (`markPresentClasses`) —, never the classes' pipelines one by one: a held frame compares seven
 * words. Each class's tile count lives in the draw the classification wrote.
 */
function encodeSurfaces(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  keys: readonly number[],
  single: GPURenderPipeline | undefined,
  tileGroup: GPUBindGroup | undefined,
) {
  const { gpu, vis } = rt,
    surfaces = gpu.surfaces!
  const pass = encoder.beginRenderPass({
    label: MATERIAL_SURFACES_PASS,
    colorAttachments: shadeColorAttachments(rt, surfaces),
  })
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  const bundles = vis.shadeBundles,
    key = bundles.keyed<ClassKey>(surfaceBundle(rt, surfaces))
  key.push(
    vis.shadeBindGroup!,
    tileGroup,
    vis.materialTiles,
    single,
    vis.shadeClasses!,
    vis.presentClasses.stamp,
    keys,
  )
  if (keys.length) bundles.execute(pass, device, recordClasses)
  pass.end()
  rt.run.gpuDrawCalls += keys.length
}

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
 * past the page table or of another class (`classAdmits`): the pixels a material depth tested
 * `equal` at the class's depth would keep, without that target or its pass. The surfaces and feedback
 * target are cleared once and then kept.
 */
export function encodeMaterialPasses(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu, vis } = rt,
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
  encodeSurfaces(rt, device, encoder, keys, singlePipeline, tileGroup)
}
