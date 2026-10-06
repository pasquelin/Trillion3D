// The shadow maps' opaque raster, then the coloured light the translucent casters let through.
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { encodeVsmRender, vsmRenderViews, type VsmRenderFrame } from '../../../../vsm/renderPass.ts'
import {
  createVsmTransmission,
  encodeVsmTransmission,
  vsmTransmissionFits,
  vsmTransmissionFloorBytes,
  type VsmTransmission,
} from '../../../../vsm/transmissionPass.ts'
import type { VsmResources } from '../../../../vsm/resources.ts'
import { VSM_PRESSURE_CALM_FRAMES } from '../../../../vsm/constants.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import { outOfMemoryContext } from '../../../../residency/outOfMemory.ts'
import type { EngineVsm } from './engineVsm.ts'
import {
  vsmTransmissionBytes,
  vsmTransmissionFirstCaps,
} from '../../../../vsm/transmissionLayout.ts'

/** The least draw context the first atlas brings for the frame's blended rows and views. */
function transmissionFloor(
  rt: WebgpuPagesRuntime,
  res: VsmResources,
  lights: VsmRenderFrame['lights'],
) {
  const { views, viewMips } = vsmRenderViews(lights)
  const { blendFirst, casterSlots } = rt.layout.rows
  return vsmTransmissionFloorBytes(
    rt.services.blendCasters.used,
    Math.max(0, casterSlots - blendFirst),
    views.length,
    viewMips,
    res.layout.poolPages,
  )
}

/**
 * The transmission this frame bins into: made with the first blended caster at the first
 * capacities (`vsmTransmissionFirstCaps`), and made again once at the capacities a frame wanted
 * (`VsmTransmission.wanted`: each short one to the power of two that holds it) — each only while
 * the GPU budget's room holds the bytes it adds to those a held one frees, and the device the
 * capacities (`vsmTransmissionFits`). Past either, said once — `shadow-transmission-bounded` for the
 * device, never asked again; `gpu-out-of-memory` for the budget —: a held transmission is kept
 * `capped`, what it cannot hold drawing no coloured transmission; with none held, the maps make
 * none (`transmissionDenied`) and the blended casters colour no shadow. A budget's cap is asked
 * again every `VSM_PRESSURE_CALM_FRAMES` frames, and grows back once the room holds it. A new
 * transmission holds none of the slices cached before it, so the world is invalidated once. None
 * without a blended caster.
 */
function heldTransmission(
  rt: WebgpuPagesRuntime,
  vsm: EngineVsm,
  device: GPUDevice,
  res: VsmResources,
  lights: VsmRenderFrame['lights'],
): VsmTransmission | undefined {
  const held = vsm.transmission
  const blocked = held ? held.capped : vsm.transmissionDenied
  if (held ? !held.wanted && !held.capped : rt.services.blendCasters.used === 0) return held
  if (blocked && rt.run.frame < vsm.transmissionRetry) return held
  const caps = held ? (held.wanted ?? held.caps) : vsmTransmissionFirstCaps(res.layout.poolPages)
  // A first transmission brings its chunk lists too, at their least (`vsmTransmissionFloorBytes`).
  const requestedBytes =
    vsmTransmissionBytes(res.layout, caps) + (held ? 0 : transmissionFloor(rt, res, lights))
  const heldBytes = held?.bytes ?? 0
  const room = ledgerRoom(device)
  // The device's limits hold for its life: capacities they refuse are asked no more.
  const bounded = !vsmTransmissionFits(res.layout, caps, device.limits)
  if (bounded || requestedBytes - heldBytes > room) {
    vsm.transmissionRetry = bounded ? Infinity : rt.run.frame + VSM_PRESSURE_CALM_FRAMES
    if (blocked) return held
    if (held) [held.capped, held.wanted] = [true, undefined]
    else vsm.transmissionDenied = true
    if (bounded)
      rt.diag.engineDiagnostic(
        'shadow-transmission-bounded',
        'The shadow transmission is as large as the device allows: its capacities stay capped',
        { kind: 'warning', ...caps },
      )
    else {
      const granted = held && { budgetBytes: heldBytes + room, allocatedBytes: heldBytes }
      rt.diag.engineDiagnostic(
        'gpu-out-of-memory',
        held
          ? 'The GPU budget holds no larger shadow transmission: its capacities stay capped'
          : 'The GPU budget holds no shadow transmission: blended casters colour no shadow',
        outOfMemoryContext('shadow', requestedBytes, granted && { ...granted, clamp: 'ceiling' }),
      )
    }
    return held
  }
  held?.destroy()
  vsm.transmission = createVsmTransmission(device, res.layout, caps, held)
  vsm.transmissionDenied = false
  const far = 1e6
  rt.lights.changes.worldChanged([-far, -far, -far], [far, far, far], false)
  return vsm.transmission
}

/** Says once that a slice held more than the longest chain of blocks: drawn uncoloured. */
function sayFull(rt: WebgpuPagesRuntime, vsm: EngineVsm, trans: VsmTransmission) {
  if (!trans.full || vsm.said.has('transmission-full')) return
  vsm.said.add('transmission-full')
  rt.diag.engineDiagnostic(
    'shadow-transmission-bounded',
    'A shadow page holds more translucent triangles than one transmission slice chains: it is drawn uncoloured',
    { kind: 'warning', slices: trans.full },
  )
}

/** Says once per set that the GPU budget's room held a shadow pass to smaller chunks, or none. */
function sayRoomLimited(
  rt: WebgpuPagesRuntime,
  vsm: EngineVsm,
  pass: 'raster' | 'transmission',
  skipped: boolean,
) {
  if (vsm.said.has(pass)) return
  vsm.said.add(pass)
  rt.diag.engineDiagnostic(
    'gpu-out-of-memory',
    skipped
      ? `The GPU budget holds no shadow ${pass} lists this frame: its pages wait`
      : `The GPU budget holds the shadow ${pass} to smaller chunks: the same pages in more passes`,
    outOfMemoryContext('shadow', null),
  )
}

/**
 * The opaque raster, then the coloured transmission of the translucent casters from the same caster rows, into `heldTransmission`'s atlas.
 */
export function encodeVsmRenderAndTransmission(
  rt: WebgpuPagesRuntime,
  vsm: EngineVsm,
  ...[encoder, res, frame, scene]: Parameters<typeof encodeVsmRender>
) {
  const stats = encodeVsmRender(encoder, res, frame, scene)
  if (stats?.roomLimited) sayRoomLimited(rt, vsm, 'raster', stats.chunks === 0)
  // No list within the budget's room: no page drawn, none kept as cached.
  if (stats?.chunks === 0) vsm.renderedPlan = undefined
  const trans = heldTransmission(rt, vsm, frame.device, res, frame.lights)
  if (!trans) return stats
  const { rows } = rt.layout
  const stamp = (rt.run.frame % 0xfffffffe) + 1
  const drawn = encodeVsmTransmission(
    encoder,
    res,
    trans,
    {
      device: frame.device,
      lights: frame.lights,
      stamp,
      rowFirst: rows.blendFirst,
      rowEnd: rows.casterSlots,
      used: rt.services.blendCasters.used,
    },
    scene,
  )
  if (drawn?.limited) sayRoomLimited(rt, vsm, 'transmission', drawn.rows === 0)
  // Pages drawn without their coloured transmission are not kept as cached: drawn again whole.
  if (drawn?.rows === 0) vsm.renderedPlan = undefined
  sayFull(rt, vsm, trans)
  trans.readFeedback(encoder)
  return stats
}
