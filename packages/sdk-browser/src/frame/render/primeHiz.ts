import type { EngineCamera } from '../../camera/engineCamera.ts'
import { HIZ_RULES } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { askHizPrimed } from '../../visibility/hiz/gpu/primed.ts'
import { onView } from '../backend/state/viewSwitch.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { farFieldOf } from './primeFarField.ts'
import { drawPrime } from './primeStage.ts'
import { ensurePrime, primeOf, primedExtent, releasePrime, type PrimeBuilt } from './primeState.ts'

/** The primed pyramid's setting `field` the session holds (`hizOptions.ts`), by its one resolver,
 *  read at each image. */
const primeSetting = contextReader(HIZ_RULES)

/** Whether the main view primes at all this image: the setting is not `'off'`, and the drawn view
 *  is the main one. */
const primes = (rt: WebgpuPagesRuntime) =>
  primeSetting(rt, 'hizPrime') !== 'off' && rt.views.active === rt.views.main

/** The shift of the primed draw's targets: one more than `hizPrimeSizeBias`. */
const primeShift = (rt: WebgpuPagesRuntime) => 1 + primeSetting(rt, 'hizPrimeSizeBias')

/** Whether there is anything to prime from: with `hizPrimeFarFieldOnly`, a placement that sets
 *  `farField`; else the view's whole cut. A primed draw of nothing costs nothing: it is not made. */
const hasObjects = (rt: WebgpuPagesRuntime) =>
  !primeSetting(rt, 'hizPrimeFarFieldOnly') || farFieldOf(rt).count > 0

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
  const mode = primeSetting(rt, 'hizPrime')
  if (mode === 'off' || !primes(rt) || (mode === 'whenMissing' && standing(rt))) return
  const { gpu, layout, run } = rt,
    device = gpu.device
  if (!device || !run.gpuSelection || !layout.rows.packedCount) return
  const farOnly = primeSetting(rt, 'hizPrimeFarFieldOnly'),
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
    error: main.pixelError * primeSetting(rt, 'hizPrimeErrorScale'),
    depthBias: primeSetting(rt, 'hizPrimeDepthBias'),
  }
  prime.built = undefined
  // An optional draw: a failure is said and the image is cut without it.
  try {
    onView(rt, prime.view, drawPrime, draw)
  } catch (error) {
    prime.built = undefined
    rt.diag.diagnosticFailure('hiz-prime-failed', error)
  }
}

/** The primed pyramid built for this image, none when the image primed nothing. */
export function builtPrime(rt: WebgpuPagesRuntime): PrimeBuilt | undefined {
  const built = primeOf(rt)?.built
  return built?.frame === rt.run.frame ? built : undefined
}
