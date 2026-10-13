import { BOUNCE_SETTINGS, type SceneProxy } from '../../../../../sdk-core/src/index.ts'
import { bounceProbeBytes } from '../../../bounce/limits.ts'
import { createGpuBounceProbes } from '../../../bounce/probes.ts'
import { grantCapability } from '../io/drops.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** What the capability declares while bouncing light is not rigged on this device. */
export const BOUNCE_CAPABILITY = 'global illumination and surface cache'
/** Named approximations of the bounce, published in the diagnostic (P5). */
const BOUNCE_APPROXIMATIONS = [
  'the cascades interpolate irradiance between eight probes, so a detail smaller than a cell is lost',
  'order-2 spherical harmonics carry the irradiance, so a sharp directional change is smoothed',
  'probe visibility uses six mean distances per probe, not a full distance map',
  'the proxy carries a certified geometric error, so a bounce leaves the coarse surface',
  'the proxy carries diffuse albedo only: emission, transparency and specular are not bounced',
  'a probe update reads the cascades as they stand, so one update may see a neighbour already updated',
  'a probe ray that exhausts the published traversal bound reports no hit, which darkens',
  'a shadow ray that exhausts that bound reports no blocker, which lights a cell that should be dark',
  'a probe ray lights the surface it lands on at the point it lands, every light and its shadow, so the cost of a ray grows with the lights',
  'a probe buried in a surface or lost in open sky goes to sleep and is skipped until a light changes',
  'the millisecond budget follows a timestamp read several frames late, and only every third or twelfth frame',
  'a point no cascade level reaches gets exactly zero bounce, never a guess',
]

/** Why there is no bounce while the host has not asked for it: the one reason a toggle lifts. */
const BOUNCE_OFF = 'the bounce is off by default; create the explorer with bounce: true'

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
 * the proxy goes into GPU memory whole and the probe grid is allocated on its extent —
 * independent of the camera, like the proxy itself (LC1).
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
  if (bounce.reason) {
    publish(rt)
    return
  }
  bounce.pending = context.readSceneProxy!()
    .then((proxy: SceneProxy) => {
      if (rt.gpu.device !== device) throw new Error('GPU_DEVICE_CHANGED')
      // The compiled meshes' proxies reach the placements through their primitives, and every placement wears
      // what its primitive holds now (`gpu/dag/proxyInstances.ts`).
      wearProxies(rt, proxy)
      bounce.proxy = proxy
      return createGpuBounceProbes(
        device,
        proxy.bounds,
        {
          buffer: () => rt.run.gpuSelection?.proxyBuffer(),
          boxes: () => rt.run.gpuSelection?.proxyBoxes() ?? EMPTY_BOXES,
        },
        () => lights.buffer!,
        bounce.budgetMs,
        () => lights.tiles,
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
    probes: probes?.cascades.probes ?? null,
    // What the occupancy map keeps: the finest-level cells that touch geometry, over all those
    // of the extent, and what the map costs in memory.
    occupiedCells: probes?.occupancy.marked ?? null,
    mapCells: probes?.occupancy.cells ?? null,
    mapBytes: probes?.occupancy.bytes ?? null,
    probeBytes: probes ? bounceProbeBytes(probes.cascades.probes) : null,
    // The target, the fraction the servo holds, and the last duration it saw.
    budgetMs: probes?.budget.budgetMs ?? bounce.budgetMs,
    budgetLoad: probes?.budget.load ?? null,
    budgetLastMs: probes?.budget.lastMs ?? null,
    budgetSamples: probes?.budget.samples ?? null,
    sweepFrames: probes?.sweepFrames ?? null,
    unavailable: bounce.reason,
    approximations: BOUNCE_APPROXIMATIONS,
  })
}

/** No placement wears a proxy yet: no box. */
const EMPTY_BOXES = { boxes: new Float64Array(0), changed: new Uint8Array(0) }

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

/** Probes follow the placements: the first image after one moved or arrived replans the cascades over their
 *  extent, marks their cells and restarts the series (`bounce/probeSync.ts`). One look at the scene's
 *  revision when nothing was written. */
export function syncLightingProxies(rt: WebgpuPagesRuntime) {
  const { probes } = rt.bounce
  if (!probes) return
  const epoch = rt.run.gate.revisions.scene
  if (seen.get(rt.bounce) === epoch) return
  seen.set(rt.bounce, epoch)
  probes.sync()
}
const seen = new WeakMap<object, number>()
