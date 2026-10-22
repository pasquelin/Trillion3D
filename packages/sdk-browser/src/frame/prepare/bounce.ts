import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { SceneProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { createGpuBounceProbes } from '../../lighting/bounce/probes/probes.ts'
import { probesPerFrameOf, screenProbeSettingsOf } from '../../lighting/bounce/screen/settingsOf.ts'
import { NO_PROXY_BOXES } from '../../lighting/bounce/probes/probeSync.ts'
import { grantCapability } from '../io/drops.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What the capability declares while bouncing light is not rigged on this device. */
export const BOUNCE_CAPABILITY = 'global illumination and surface cache'
/** Named approximations of the bounce, published in the diagnostic (P5). */
const BOUNCE_APPROXIMATIONS = [
  'the levels interpolate irradiance between eight probes, so a detail smaller than a cell is lost',
  'order-2 spherical harmonics carry the irradiance, so a sharp directional change is smoothed',
  'probe visibility uses six mean distances per probe, not a full distance map',
  'the proxy carries a certified geometric error, so a bounce leaves the coarse surface',
  'the proxy carries diffuse albedo only: emission, transparency and specular are not bounced',
  'a probe update reads the levels as they stand, so one update may see a neighbour already updated',
  'a probe ray that exhausts the published traversal bound ends as a hit where it stopped, lit by the cascades alone, and a shadow ray has a budget of its own and, exhausted, is lit unless the walk of one mesh ran out of stack in it',
  'a probe ray lights the surface it lands on at the point it lands, every light and its shadow, so the cost of a ray grows with the lights',
  'a probe buried in a surface or lost in open sky goes to sleep and is skipped until a light or the sky changes',
  'a frame traces a fixed budget of probes (`probesPerFrame`, in the cost of a whole map each: a quarter for a probe past the downsample distance) whatever the time the pass takes: a slow device lowers the count, nothing lowers it for it',
  'a point no level holds a probe for gets no bounce from the probes, never a guess: the sky light, where one shines, is all it gets',
  'a probe is given to a cell only once the image has read it, a few images late, and traced a few updates after: a view that turns finds the cells it turns to unanswered for an instant',
  'the pool holds a fixed count of probes: past it a cell asked for goes unanswered until a probe is given back',
  'a surface a probe ray or a reflection hits is lit by the probes alone, none of the sky light: it is dark while the probes round it hold nothing yet, and fills as they do; a surface the image does not show has no probes of its own, so it gets no second bounce',
  'a probe stops being updated after a fixed count of updates, until a light changes',
  'the sky reaches the probes as a table by direction built at the ground, the sun not in it: the sky light of a point the probes do not answer is the unoccluded one, and a scene with no sky light has none to give: the probes that answer stand for it',
  'a pixel reads its indirect light from the screen probes, one a tile of pixels, so a detail smaller than a tile reaches it only by the short-range occlusion; where the screen probes cast none (level off, no lit image yet), it reads the world probes',
  'a screen probe ray the last lit image does not answer, and the scene trace does not, reads the radiance cache: the map of the light by direction every world probe holds, traced over the frames at the budget of the level, so what is far is as the maps hold it, a few images late; and a surface that moved gives its pixel no history that image',
  "a world probe's map is traced from the diagonal of its cell out, so what lies within it is the screen's and the scene trace's to give, never the map's",
]

/** Why there is no bounce while the host has switched it off: the one reason a toggle lifts. */
const BOUNCE_OFF = 'the bounce is switched off; create the explorer with bounce: true'

/**
 * Turns bouncing light on or off during the session. Off, the grid stops being updated and read,
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

/**
 * Rigs bouncing light, at the first image that carries a declared lamp.
 *
 * Nothing is loaded before: a scene without a lamp has nothing to bounce, and the proxy's cache
 * object weighs tens of megabytes that would delay its first image for nothing. Once it arrives,
 * the proxy goes into GPU memory whole and the probes' pool is allocated, its levels
 * following the eye (LC1).
 *
 * Everything is optional: a cache without a proxy, a device that refuses the pass or a host that
 * does not want it keep a correct image and a declared missing capability. Nothing is dropped in
 * silence.
 */
export function ensureBounce(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { bounce, lights, context } = rt
  if (bounce.probes || bounce.pending || bounce.reason) return
  if (!bounce.wanted) bounce.reason = BOUNCE_OFF
  else if (!context.readSceneProxy)
    bounce.reason = 'the cache carries no resident proxy; recompile it with this compiler'
  else if (!lights.buffer) bounce.reason = 'the declared-light buffer is unavailable'
  else if (!rt.gpu.deferred) bounce.reason = 'the deferred lighting is unavailable'
  if (bounce.reason) {
    publish(rt)
    return
  }
  bounce.pending = context.readSceneProxy!()
    .then((proxy: SceneProxy) => {
      if (rt.gpu.device !== device) throw new Error('GPU_DEVICE_CHANGED')
      // The compiled meshes' proxies reach the placements through their primitives, and every placement wears
      // what its primitive holds now (`geometry/dag/proxy/proxyInstances.ts`).
      wearProxies(rt, proxy)
      bounce.proxy = proxy
      return createGpuBounceProbes(
        device,
        proxy.bounds,
        {
          proxy: () => rt.run.gpuSelection?.proxy(),
          boxes: () => rt.run.gpuSelection?.proxyBoxes() ?? NO_PROXY_BOXES,
        },
        () => lights.buffer!,
        () => probesPerFrameOf(rt),
        rt.gpu.deferred!.placeholders.tiles,
        () => lights.tiles,
        () => screenProbeSettingsOf(rt),
      )
    })
    .then((probes) => {
      if (rt.gpu.device !== device) {
        probes.dispose()
        return
      }
      bounce.probes = probes
      grantCapability(rt.capabilities, BOUNCE_CAPABILITY)
      rt.run.gate.resourcesChanged()
      publish(rt)
    })
    .catch((error: unknown) => {
      if (rt.gpu.device !== device) return
      bounce.reason = `bounce unavailable: ${String(error)}`
      rt.diag.diagnosticFailure('bounce-unavailable', error)
      publish(rt)
    })
}

/** What the bounce actually obtained: proxy size, grid, budget. Never an estimate. */
function publish(rt: WebgpuPagesRuntime) {
  const { bounce, diag } = rt,
    probes = bounce.probes
  diag.engineDiagnostic('bounce-lighting', 'Bouncing light rigged', {
    version: 1,
    settings: { ...BOUNCE_SETTINGS },
    proxyMeshes: bounce.proxy?.meshes ?? null,
    proxyTriangles: bounce.proxy?.triangles ?? null,
    proxyNodes: bounce.proxy?.nodes ?? null,
    proxyErrorMetres: bounce.proxy?.errorMetres ?? null,
    proxyCellMetres: bounce.proxy?.cellMetres ?? null,
    cascadeLevels: probes?.cascades.levels.length ?? null,
    cascadeSize: probes?.cascades.size ?? null,
    cascadeSpacings: probes?.cascades.levels.map((level) => level.spacing) ?? null,
    // The pool, and what it holds now: probes alive, those still short of their updates, the marks
    // the pool had no probe left for.
    probes: probes?.cascades.probes ?? null,
    liveProbes: probes?.pool.live ?? null,
    refusedMarks: probes?.pool.refused ?? null,
    probeBytes: probes?.probeBytes ?? null,
    // The probes a frame traces, those never traced first, and the last duration of the pass.
    probesPerFrame: probesPerFrameOf(rt),
    passMs: probes ? bounce.passMs : null,
    unavailable: bounce.reason,
    approximations: BOUNCE_APPROXIMATIONS,
  })
}

/** The meshes' proxies of a compiled scene set on the primitives that wear them, one a compiled primitive in
 *  the manifest's order, and the placements told: the scene's proxy is one structure, whether the compiler
 *  or the world built the mesh's proxy. */
function wearProxies(rt: WebgpuPagesRuntime, proxy: SceneProxy) {
  const { primitives } = rt.context.metadata
  if (primitives.length !== proxy.data.meshes.length)
    throw new Error('the proxy names another count of primitives than the manifest does')
  primitives.forEach((primitive, at) => {
    const mesh = proxy.data.meshes[at]
    if (mesh.triangles.length) primitive.runtimeProxy = mesh
  })
  rt.run.gpuSelection?.proxyArrived()
}

/** Probes follow the placements: the first image after one moved or arrived places the world light grid and
 *  the rays' reach on their extent and restarts the series (`lighting/bounce/probes/probeSync.ts`). One look at the scene's
 *  revision when nothing was written. */
export function syncLightingProxies(rt: WebgpuPagesRuntime) {
  const { probes } = rt.bounce
  if (!probes) return
  const epoch = rt.run.gate.revisions.scene
  if (rt.bounce.sceneEpoch === epoch) return
  rt.bounce.sceneEpoch = epoch
  probes.sync()
}
