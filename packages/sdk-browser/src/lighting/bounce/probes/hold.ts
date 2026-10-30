import type { BounceShape } from '../../../../../sdk-core/src/bounce/contracts.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { NO_PLACEMENT_BOXES } from '../../../geometry/dag/placement/placementBoxes.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { bounceHitLightingFollowOf } from '../../../frame/render/bounceHitLighting.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import { cachedLightingPreExposureOf } from '../../../post/exposure/frame.ts'
import type { SurfaceHitReads } from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { MarkSurface } from '../pool/pool.ts'
import { createGpuBounceProbes, type GpuBounceProbes, type ProbeOptions } from './probes.ts'

/** The images a cache of probes, or a volume, that is no longer wanted keeps what it made before it gives it back (a camera that is
 *  not a perspective for a moment, a setting turned off and on). */
const KEEP_IMAGES = 8

/**
 * A radiance cache of its own beside the world's (the irradiance field's, the translucency volume's), kept between two images: its
 * probes, made off the frame for the shape `key` names, given back after `KEEP_IMAGES` images it was not wanted.
 */
export interface ProbeHold {
  probes: GpuBounceProbes | undefined
  /** The shape the probes are made, or being made, for. */
  key: string | undefined
  /** The images since the cache was last wanted. */
  idle: number
  shape: BounceShape | undefined
  shapeKey: string | undefined
  settings: ScreenProbeSettings | undefined
  /** What the pool is marked from. */
  readonly surface: MarkSurface
}

/** What a cache's probes read and follow in an image. */
export interface ProbeFrame {
  reads: SurfaceHitReads
  rays: SceneRays | undefined
  viewpoint: ArrayLike<number>
  forward: ArrayLike<number> | undefined
}

/** An image without the cache: true once it has been unwanted `KEEP_IMAGES` images, when the caller gives it back. */
export const idleExpired = (hold: { idle: number }) => ++hold.idle >= KEEP_IMAGES

/** The probes of the shape `key` made, off the frame, the levels first centred on the origin: kept where `hold` still asks that shape on
 *  that device (`made`), else given back with `given`; a failure said as `failure`. */
export function startHeldProbes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  hold: ProbeHold,
  key: string,
  options: ProbeOptions,
  failure: string,
  made: (probes: GpuBounceProbes) => void = (probes) => void (hold.probes = probes),
  given: () => void = () => undefined,
) {
  hold.key = key
  void createGpuBounceProbes(
    device,
    [0, 0, 0, 0, 0, 0],
    { boxes: () => NO_PLACEMENT_BOXES },
    () => rt.lights.buffer!,
    () => hold.settings!,
    { shape: hold.shape, ...options },
  )
    .then((probes) => {
      if (hold.key !== key || rt.gpu.device !== device) return (probes.dispose(), given())
      made(probes)
      rt.run.gate.resourcesChanged()
    })
    .catch((error: unknown) => {
      given()
      if (hold.key !== key) return
      rt.diag.diagnosticFailure(failure, error)
    })
}

/** The probe pass of a held cache in this image: a great change of the lighting (`bounce.historyLost`) discards what it holds, its
 *  levels follow the eye, the cells its surface marks take probes. */
export function encodeHeldProbes(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  probes: GpuBounceProbes,
  surface: MarkSurface,
  frame: ProbeFrame,
) {
  if (rt.bounce.historyLost) probes.discard()
  const exposure = cachedLightingPreExposureOf(rt)
  const followed = bounceHitLightingFollowOf(rt)
  probes.track(frame.viewpoint, exposure, followed)
  probes.encode(
    encoder,
    frame.viewpoint,
    skyLightReadOf(rt),
    frame.reads,
    exposure,
    surface,
    frame.rays,
    frame.forward,
    followed,
  )
}
