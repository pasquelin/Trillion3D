import type { EngineCamera } from '../../camera/engineCamera.ts'
import { cameraSelectionUniforms, type SelectionUniforms } from '../../gpu/core/selection.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { HIZ_LEVELS } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { ensureWebgpuVisibilityBindings } from '../../visibility/passes/bindings.ts'
import { sendDrawItemWords } from '../../visibility/passes/itemWords.ts'
import { writeWebgpuVisibilityUniforms } from '../../visibility/passes/uniforms.ts'
import { HIZ_PASS, PARTITION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { viewProj } from '../backend/helpers.ts'
import { prepared } from '../backend/state/prepared.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { visibilityRasterStages } from './encodeVisSetup.ts'
import type { Prime } from './primeState.ts'

/** What the primed pyramid is drawn under, decided by the image that asks it (`primeHiz.ts`). */
export type PrimeDraw = {
  device: GPUDevice
  prime: Prime
  /** The main view's camera, the main view's uniforms, and the filter of the placements drawn. */
  cam: EngineCamera
  main: SelectionUniforms
  filter: Uint32Array | undefined
  /** The cut's pixel error and the distance the depth is pushed by. */
  error: number
  depthBias: number
}

/** The compaction's compute pass and the pyramid's, opened by what dispatches into them. */
const compaction = new LazyComputePass(PARTITION_PASS),
  pyramidPass = new LazyComputePass(HIZ_PASS)
/** Bytes of a levels uniform. */
const LEVELS_BYTES = HIZ_LEVELS.words * 4

/**
 * THE PRIMED DRAW, with the primed view drawn (`onView`): the cut of the view's frustum at the
 * main view's matrix, its pixel error scaled, over the placements `filter` keeps, then the depth of
 * its main pass alone — hardware slots, then software lists, into the small depth target — and the
 * pyramid built from it with the push of its level 0, in a command buffer of its own, submitted
 * before the image's: the cut's tables and the raster's buffers are written by the queue, and an
 * image encoded behind this one would read the last of those writes. No identifier is resolved, no
 * post pass runs, nothing is read back. Returns whether the pyramid stands: not when the cut's
 * tables are made again, or the primed kernel is not compiled yet.
 */
export function drawPrime(rt: WebgpuPagesRuntime, draw: PrimeDraw) {
  const { device, prime } = draw,
    { run, gpu, vis } = rt
  // The same resources the image's own encode needs (`encodeVis`).
  if (!vis.visBindGroupLayout || !gpu.cache || !vis.concatPos || !vis.pageTable) return false
  if (!rt.layout.rows.pageTableInts) return false
  viewProj.set(prime.matrix)
  const uniforms = primeUniforms(rt, draw)
  const encoder = device.createCommandEncoder({ label: 'Trillion3D primed pyramid' })
  // The running cut replaced since (`adoptGrownCut`): the cut on its tables is made anew.
  if (prime.selection !== run.gpuSelection) {
    prime.cut?.dispose()
    prime.selection = run.gpuSelection
    prime.cut = prime.selection!.aside(true)
  }
  const settle = prime.cut!.dispatch(uniforms, encoder)
  if (!settle) return false
  let pyramid: GPUTextureView | undefined
  try {
    pyramid = encodeDepth(rt, draw, encoder)
    if (pyramid) device.queue.submit([encoder.finish()])
  } catch (error) {
    settle(false)
    throw error
  }
  settle(!!pyramid)
  if (!pyramid) return false
  prime.built = {
    frame: run.frame,
    view: pyramid,
    levels: prime.levels,
    size: [gpu.targetSize[0], gpu.targetSize[1]],
  }
  return true
}

/** The primed view's cut uniforms: its camera's, at its size and the main view's matrix, the main
 *  view's culls, plane and distances, one pass, over `filter`. */
function primeUniforms(rt: WebgpuPagesRuntime, { cam, main, filter, error }: PrimeDraw) {
  const { run, gpu } = rt,
    uniforms = cameraSelectionUniforms(
      cam,
      error,
      [gpu.targetSize[0], gpu.targetSize[1]],
      run.selectionUniforms,
      viewProj,
    )
  uniforms.cullOff = main.cullOff
  uniforms.viewDistanceScale = main.viewDistanceScale
  uniforms.clipPlane = main.clipPlane
  uniforms.filter = filter
  uniforms.occlusion = 0
  uniforms.frame = run.frame
  return uniforms
}

/** The raster of the cut's main pass into the primed targets and the pyramid built from its depth,
 *  with its levels copied; the pyramid's texture view, none when its kernel is not compiled. */
function encodeDepth(rt: WebgpuPagesRuntime, draw: PrimeDraw, encoder: GPUCommandEncoder) {
  const { device, cam } = draw,
    { vis, run, layout, gpu } = rt
  // The rows' words go up before the image's own, and the visibility uniform and its groups follow
  // the primed view: the image's rewrites them behind this one.
  sendDrawItemWords(rt)
  writeWebgpuVisibilityUniforms(rt, device, cam, layout.rows.rowCount)
  ensureWebgpuVisibilityBindings(rt)
  const stages = visibilityRasterStages(rt, device, encoder, true)
  if (!stages) throw new Error('VISIBILITY_RASTER_UNAVAILABLE')
  prepared(vis, 'gpuDraw').encode(
    compaction.begin(encoder),
    layout.rows.packedCount,
    run.gpuSelection,
  )
  compaction.end()
  stages.occluders(encoder)
  const hiz = prepared(vis, 'gpuHiz')
  hiz.extent(gpu.targetSize[0], gpu.targetSize[1])
  const built = hiz.encodePrimed(pyramidPass.begin(encoder), {
    near: cam.near,
    far: cam.far,
    perspective: cam.perspective,
    bias: draw.depthBias,
  })
  pyramidPass.end()
  const view = hiz.pyramidView()
  if (!built || !view) return undefined
  encoder.copyBufferToBuffer(hiz.levelTable, 0, draw.prime.levels, 0, LEVELS_BYTES)
  return view
}
