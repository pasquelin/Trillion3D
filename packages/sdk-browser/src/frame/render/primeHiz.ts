import type { EngineCamera } from '../../camera/engineCamera.ts'
import { readHizSetting } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import { askHizPrimed } from '../../visibility/hiz/gpu/primed.ts'
import { onView } from '../backend/state/viewSwitch.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { farFieldOf } from './primeFarField.ts'
import { drawPrime } from './primeStage.ts'
import { notePrimeBuilt } from './primeBuilt.ts'
import { ensurePrime, primeOf, primedExtent, releasePrime } from './primeState.ts'

/** Whether the main view primes at all this image: the setting is not `'off'`, and the drawn view
 *  is the main one. */
const primes = (rt: WebgpuPagesRuntime) =>
  readHizSetting(rt, 'hizPrime') !== 'off' && rt.views.active === rt.views.main

/** The shift of the primed draw's targets: one more than `hizPrimeSizeBias`. */
const primeShift = (rt: WebgpuPagesRuntime) => 1 + readHizSetting(rt, 'hizPrimeSizeBias')

/** Whether there is anything to prime from: with `hizPrimeFarFieldOnly`, a placement that sets
 *  `farField`; else the view's whole cut. A primed draw of nothing costs nothing: it is not made. */
const hasObjects = (rt: WebgpuPagesRuntime) =>
  !readHizSetting(rt, 'hizPrimeFarFieldOnly') || farFieldOf(rt).count > 0

/**
 * At a frame's entry (`../loop/framePipelines.ts`): the primed pyramid's targets, raster and
 * kernel asked while the setting asks for one and there is something to draw — the frame is held
 * until they are compiled —, and given back when none is. A runtime that never primes makes and
 * asks nothing.
 */
export function askPrimeHiz(rt: WebgpuPagesRuntime) {
  if (rt.views.active !== rt.views.main) return
  const device = rt.gpu.device
  if (!device || !primes(rt) || !rt.run.gpuSelection || !hasObjects(rt)) return releasePrime(rt)
  if (ensurePrime(rt, device, primeShift(rt))) askHizPrimed(device)
}

/**
 * The primed pyramid of the image, built before the cut's main pass (`decideOcclusion`): when the
 * setting asks it — `'always'`, or `'whenMissing'` while the view has no pyramid of the image
 * before (`standing` false) — and the cut runs its occlusion, a small, coarse draw of the view's
 * placements that set `farField` (all of them without `hizPrimeFarFieldOnly`): the cut of the
 * main view's frustum at its matrix with the pixel error times `hizPrimeErrorScale`, the depth of
 * its main pass at the size of the image shifted right by `1 + hizPrimeSizeBias`, pushed away by
 * `hizPrimeDepthBias` metres into a pyramid (`builtPrime`). Nothing is drawn, encoded or sent when
 * the setting is `'off'`, the pyramid stands, or no placement is flagged.
 */
export function primeHizFrame(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  standing: (rt: WebgpuPagesRuntime) => boolean,
) {
  const mode = readHizSetting(rt, 'hizPrime')
  if (mode === 'off' || !primes(rt) || (mode === 'whenMissing' && standing(rt))) return
  const { gpu, layout, run } = rt,
    device = gpu.device
  if (!device || !run.gpuSelection || layout.packedPages.length === layout.blendedPageCount) return
  const farOnly = readHizSetting(rt, 'hizPrimeFarFieldOnly'),
    far = farFieldOf(rt)
  if (farOnly && far.count === 0) return
  const prime = primeOf(rt)
  if (!prime || !askHizPrimed(device)) return
  const [width, height] = gpu.targetSize,
    shift = primeShift(rt)
  prime.matrix.set(taaRenderMatrix(rt, cam))
  prime.view.cam = cam
  const drawn = prime.view.gpu.targetSize
  drawn[0] = primedExtent(width, shift)
  drawn[1] = primedExtent(height, shift)
  const main = run.selectionUniforms
  const draw = {
    device,
    prime,
    cam,
    main,
    filter: farOnly ? far.bits : main.filter,
    error: main.pixelError * readHizSetting(rt, 'hizPrimeErrorScale'),
    depthBias: readHizSetting(rt, 'hizPrimeDepthBias'),
  }
  notePrimeBuilt(rt, undefined)
  // An optional draw: a failure is said and the image is cut without it.
  try {
    onView(rt, prime.view, drawPrime, draw)
  } catch (error) {
    notePrimeBuilt(rt, undefined)
    rt.diag.diagnosticFailure('hiz-prime-failed', error)
  }
}
