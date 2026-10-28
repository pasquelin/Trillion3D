import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { createGpuBounceProbes } from '../../lighting/bounce/probes/probes.ts'
import { screenProbeSettingsOf } from '../../lighting/bounce/screen/settingsOf.ts'
import { restartTranslucencyCache } from '../../lighting/translucencyGi/cache.ts'
import { grantCapability } from '../io/drops.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What the capability declares while bouncing light is not rigged on this device. */
export const BOUNCE_CAPABILITY = 'global illumination and surface cache'
/** Named approximations of the bounce, published in the diagnostic (P5). */
const BOUNCE_APPROXIMATIONS = [
  'the world is lit by the screen probes, which trace the global distance field and read the radiance cache for what lies past it: the cache holds a map of the light by direction in each world probe, so a detail smaller than a probe cell reaches a pixel only through the screen probes and their short-range occlusion',
  'a frame traces a fixed budget of probe maps (`probesPerFrame`, in the cost of a whole map each: a quarter for a probe past the downsample distance) whatever the time the pass takes: a slow device lowers the count, nothing lowers it for it',
  'a point no level holds a probe for reads no radiance cache: the sky light, where one shines, is all it gets',
  'a probe is given to a cell only once the screen probes of the last image stood in it, and traced a few images after: a view that turns finds the cells it turns to unanswered for an instant',
  'the pool holds a fixed count of probes: past it a cell asked for goes unanswered until a probe is given back',
  'a probe is traced again at every image the budget has room for, and the series closes, the frame holding, once every probe has been traced since the lights last changed',
  "the sky reaches the radiance cache through the sky light's cube alone: a scene with no sky light has none to give",
  "a pixel reads its indirect light from the screen probes, one a tile of pixels; where they cast none (level off, no lit image yet), it reads the sky light's irradiance",
  'a screen probe ray the last lit image does not answer, and the scene trace does not, reads the radiance cache, traced over the frames at the budget of the level, so what is far is as the maps hold it, a few images late; and a surface that moved gives its pixel no history that image',
  "a probe's map is traced from the diagonal of its cell out, so what lies within it is the screen's and the scene trace's to give, never the map's",
]

/** Why there is no bounce while the host has switched it off: the one reason a toggle lifts. */
const BOUNCE_OFF = 'the bounce is switched off; create the explorer with bounce: true'

/**
 * Turns bouncing light on or off during the session. Off, the pool stops being traced and read,
 * and is kept; on again, it is rigged at the next image that carries a lamp (`ensureBounce`) or
 * read again as it stands — no program, table or pool is rebuilt either way.
 */
export function setWebgpuBounce(rt: WebgpuPagesRuntime, on: boolean) {
  const { bounce } = rt
  if (bounce.wanted === on) return
  bounce.wanted = on
  if (on && bounce.reason === BOUNCE_OFF) bounce.reason = null
  rt.run.gate.resourcesChanged()
}

/** Why the bounce cannot be rigged yet, or null: the host switched it off, the lamps are not in their buffer, the deferred lighting is not made. */
function missingInput(rt: WebgpuPagesRuntime) {
  if (!rt.bounce.wanted) return BOUNCE_OFF
  if (!rt.lights.buffer) return 'the declared-light buffer is unavailable'
  if (!rt.gpu.deferred) return 'the deferred lighting is unavailable'
  return null
}

/**
 * Rigs bouncing light at the first image that carries a declared lamp, and records why when it cannot (`missingInput`). Nothing is made before: a scene without a lamp has
 * nothing to bounce. Everything is optional: a device that refuses the pass or a host that does not want it keep a correct image and a declared missing capability.
 */
export function ensureBounce(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { bounce } = rt
  if (bounce.probes || bounce.pending || bounce.reason) return
  const missing = missingInput(rt)
  if (!missing) return rig(rt, device)
  bounce.reason = missing
  publish(rt)
}

/** The probes' pool, allocated over the extent of the placements, its levels following the eye; the rays march the global distance field. */
function rig(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { bounce, lights } = rt
  // The placements' extent is the cut's: rigged at the first image that has one.
  const selection = rt.run.gpuSelection
  if (!selection) return
  const rigging = createGpuBounceProbes(
    device,
    selection.placementBoxes().extent,
    { boxes: () => selection.placementBoxes() },
    () => lights.buffer!,
    () => screenProbeSettingsOf(rt),
  )
    .then((probes) => {
      if (rt.gpu.device !== device) {
        probes.dispose()
        forget()
        return
      }
      bounce.probes = probes
      grantCapability(rt.capabilities, BOUNCE_CAPABILITY)
      rt.run.gate.resourcesChanged()
      publish(rt)
    })
    .catch((error: unknown) => {
      if (rt.gpu.device !== device) return forget()
      bounce.reason = `bounce unavailable: ${String(error)}`
      rt.diag.diagnosticFailure('bounce-unavailable', error)
      publish(rt)
    })
  /** The rigging made for a device that is gone leaves no trace: the next entry rigs again on the device it finds. */
  const forget = () => {
    if (bounce.pending === rigging) bounce.pending = undefined
  }
  // The images go on while it is made: the bounce shows once the probes land, which is a resource change, and the view is held after (`unsettled`: `bounceProbes`).
  bounce.pending = rigging
}

/**
 * At a frame's entry, the bounce rigged as soon as its inputs exist: a lamp in the light buffer on the GPU, the deferred lighting, the cut. Asked before the image that carries
 * the lamp is encoded, so that no image is drawn while the probes are made. It records no refusal: what is missing now arrives with a later image.
 */
export function askBounce(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { bounce, lights } = rt
  if (lights.store.unlit || !lights.store.count) return
  if (bounce.probes || bounce.pending || bounce.reason || missingInput(rt)) return
  rig(rt, device)
}

/** What the bounce actually obtained: placements, grid, budget. Never an estimate. */
function publish(rt: WebgpuPagesRuntime) {
  const { bounce, diag } = rt,
    probes = bounce.probes
  diag.engineDiagnostic('bounce-lighting', 'Bouncing light rigged', {
    version: 2,
    settings: { ...BOUNCE_SETTINGS },
    placements: probes?.placements() ?? null,
    cascadeLevels: probes?.cascades.levels.length ?? null,
    cascadeSize: probes?.cascades.size ?? null,
    cascadeSpacings: probes?.cascades.levels.map((level) => level.spacing) ?? null,
    // The pool, and what it holds now: probes alive, the marks the pool had no probe left for.
    probes: probes?.cascades.probes ?? null,
    liveProbes: probes?.stats.live ?? null,
    refusedMarks: probes?.stats.refused ?? null,
    tableBytes: probes?.tableBytes ?? null,
    // The probes a frame traces, those never traced first, and the last duration of the pass.
    probesPerFrame: screenProbeSettingsOf(rt).cache.budget,
    passMs: probes ? bounce.passMs : null,
    unavailable: bounce.reason,
    approximations: BOUNCE_APPROXIMATIONS,
  })
}

/** Probes follow the placements: the first image after one moved or arrived restarts the series
 *  (`lighting/bounce/probes/probeSync.ts`). One look at the scene's revision when nothing was written. */
export function syncBouncePlacements(rt: WebgpuPagesRuntime) {
  const { probes } = rt.bounce
  if (!probes) return
  const epoch = rt.run.gate.revisions.scene
  if (rt.bounce.sceneEpoch === epoch) return
  rt.bounce.sceneEpoch = epoch
  // The volume's own cache reads no placements of its own: it follows the moves the world's probes saw.
  if (probes.sync()) restartTranslucencyCache(rt.bounce)
}
