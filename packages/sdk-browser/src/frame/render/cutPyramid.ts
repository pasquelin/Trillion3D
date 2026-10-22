import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import { writeClipDepth } from '../../gpu/core/selectionProjection.ts'
import type { CutPyramid } from '../../geometry/dag/occlusion.ts'
import { OCCLUSION_TWO_PASS } from '../../geometry/dag/shader/occlusionWgsl.ts'
import { HIZ_LEVELS } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { builtPrime } from './primeHiz.ts'
import type { PrimeBuilt } from './primeState.ts'
import { cutPyramid, pyramidSources, standingSource } from './pyramidSources.ts'

/**
 * THE PYRAMID THE CUT'S OCCLUSION READS (`../../geometry/dag/shader/occlusionWgsl.ts`), and what it
 * was built from. Each view's Hi-Z pyramid (`WebgpuView.hiz`) is built from its image's whole depth
 * once the image drew both passes (`../../visibility/passes/passes.ts`): the next image's main pass
 * tests against it, projected with the matrix, the depth map and the size that image drew with, and
 * read through the levels uniform it was built with — copied on the GPU behind the build, since a
 * render scale that moves rewrites the Hi-Z's own before the next image's main pass reads it
 * (`GpuHiz.extent`) —, all kept here, the view's own, as the image notes its pyramid built
 * (`notePyramidBuilt`). The poses the last frame drew are the cut's
 * (`../../geometry/dag/previousPoses.ts`).
 *
 * A pyramid stands for the view's next image while it is the one in place — the texture a resize
 * makes again is another —, whatever size that image draws at: a box is tested in the previous
 * image's pixels (`prevSize`). Then, and only when the host asks it (`cutTwoPassOcclusion`,
 * `cutOcclusionCulling`), the view's cut — the main one, or a view's aside — runs its two passes;
 * otherwise one, no pyramid hiding anything: a view's first image, a capture's only one.
 */
/** Bytes of a levels uniform. */
const LEVELS_BYTES = HIZ_LEVELS.words * 4

/** The drawn view's pyramid was built from its image, drawn under `cam`, into `encoder`: what the
 *  view's next main pass tests against when it holds the image's `whole` depth, nothing otherwise.
 *  A source of another pyramid, or of none, goes, its levels retired — this image's main pass may
 *  bind them (`../../gpu/core/frameRetire.ts`). */
export function notePyramidBuilt(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  whole: boolean,
) {
  const pyramid = cutPyramid(rt),
    view = rt.views.active,
    device = rt.gpu.device!
  let source = pyramidSources.get(view)
  if (source && (!pyramid || !whole || source.view !== pyramid.view)) {
    retire(device, source.levels)
    pyramidSources.delete(view)
    source = undefined
  }
  if (!pyramid || !whole) return
  source ??= {
    viewProj: new Float64Array(16),
    depthMap: [0, 0],
    size: [0, 0],
    view: pyramid.view,
    levels: device.createBuffer({
      label: 'Trillion3D cut pyramid levels',
      size: LEVELS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  }
  source.viewProj.set(taaRenderMatrix(rt, cam))
  writeClipDepth(source.depthMap, cam.projection)
  source.size[0] = rt.gpu.targetSize[0]
  source.size[1] = rt.gpu.targetSize[1]
  encoder.copyBufferToBuffer(pyramid.levels, 0, source.levels, 0, LEVELS_BYTES)
  pyramidSources.set(view, source)
}

/**
 * The occlusion `uniforms` run, written under `cam` for the drawn view: two passes when `asked` and
 * the view's last pyramid stands for this image — its previous render matrix at this image's eye,
 * depth map and size then written —, one otherwise. Returns the pyramid the main pass reads — its
 * texture, through the levels it was built with —, none for a cut in one pass.
 */
export function writeCutOcclusion(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  uniforms: SelectionUniforms,
  asked: boolean,
): CutPyramid | undefined {
  const primed = asked ? builtPrime(rt) : undefined
  if (primed) return primedOcclusion(uniforms, primed)
  const source = asked ? standingSource(rt) : undefined
  uniforms.occlusion = source ? OCCLUSION_TWO_PASS : 0
  if (!source) return undefined
  const prevViewProj = (uniforms.prevViewProj ??= new Float32Array(16))
  matrixAtRenderOrigin(prevViewProj, source.viewProj, cam.eye)
  const depthMap = (uniforms.prevDepthMap ??= [0, 0]),
    size = (uniforms.prevSize ??= [0, 0])
  depthMap[0] = source.depthMap[0]
  depthMap[1] = source.depthMap[1]
  size[0] = source.size[0]
  size[1] = source.size[1]
  return { view: source.view, levels: source.levels }
}

/**
 * The occlusion `uniforms` run in two passes against the primed pyramid (`primeHiz.ts`), the one
 * the reference's image takes in place of the previous image's: its matrix is this image's own,
 * its depth map this image's, its size the primed draw's. Returns the pyramid the main pass reads.
 */
function primedOcclusion(uniforms: SelectionUniforms, primed: PrimeBuilt): CutPyramid {
  uniforms.occlusion = OCCLUSION_TWO_PASS
  const prevViewProj = (uniforms.prevViewProj ??= new Float32Array(16))
  prevViewProj.set(uniforms.viewProj)
  const depthMap = (uniforms.prevDepthMap ??= [0, 0]),
    size = (uniforms.prevSize ??= [0, 0])
  depthMap[0] = uniforms.depthMap[0]
  depthMap[1] = uniforms.depthMap[1]
  size[0] = primed.size[0]
  size[1] = primed.size[1]
  return { view: primed.view, levels: primed.levels }
}
