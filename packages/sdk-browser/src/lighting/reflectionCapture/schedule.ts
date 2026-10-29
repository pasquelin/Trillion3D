import {
  reflectionCaptureCentre,
  type ResolvedReflectionCapture,
} from '../../../../sdk-core/src/scene/reflectionCapture/contracts.ts'
import type { ReflectionCaptureSettings } from '../../../../sdk-core/src/contracts/reflectionCaptureOptions.ts'
import { reflectionCaptureSide } from '../../../../sdk-core/src/contracts/reflectionCaptureOptions.ts'

/**
 * WHEN A REFLECTION CAPTURE IS CAPTURED. Pure: it decides, `capture.ts` draws. A capture is asked when it is added, when the point it is
 * captured from moves (its centre or its capture offset), when the settings that shape its faces change (the cube's side, the supersampling, the near
 * plane, the light functions, the diffuse light's two switches, the sky light's distance threshold the faces fade out past), and when the host asks (`recapture`). A change of its brightness, its shape,
 * its radius or its transition changes no pixel of the cube and asks for none: the records are written again. A capture that is no longer
 * in the scene frees its layer of the array.
 */

/** What a capture was made with: its key, and the layer of the array it is in. */
export interface CaptureHeld {
  key: string
  layer: number
  /** The cube of the layer holds this capture's key. */
  done: boolean
}

/** The point a capture is captured from, metres. */
export const captureEye = (capture: ResolvedReflectionCapture) => {
  const c = reflectionCaptureCentre(capture)
  return [
    c[0] + capture.captureOffset[0],
    c[1] + capture.captureOffset[1],
    c[2] + capture.captureOffset[2],
  ] as const
}

/** What a change of asks a capture of `capture` under `settings`. */
export const captureKey = (
  capture: ResolvedReflectionCapture,
  settings: ReflectionCaptureSettings,
  skyDistance?: number,
) =>
  JSON.stringify([
    captureEye(capture),
    skyDistance,
    reflectionCaptureSide(settings),
    settings.reflectionCaptureSupersample,
    settings.reflectionCaptureNearPlane,
    settings.reflectionCaptureLightFunctions,
    settings.reflectionCaptureDiffuse,
    settings.reflectionCaptureDiffuseReference,
  ])

/**
 * The look at the scene's captures: the held ones forgotten when removed, a layer given to each new one (the lowest free), and the ones whose key
 * differs from the held key returned, in the order of `captures`. A held capture keeps showing its old cube while the new one is drawn.
 */
export function lookAtCaptures(
  held: Map<string, CaptureHeld>,
  captures: readonly ResolvedReflectionCapture[],
  settings: ReflectionCaptureSettings,
  capacity: number,
  skyDistance?: number,
) {
  const names = new Set(captures.map((c) => c.id))
  for (const id of held.keys()) if (!names.has(id)) held.delete(id)
  const used = new Set([...held.values()].map((h) => h.layer))
  const due: ResolvedReflectionCapture[] = []
  for (const capture of captures) {
    const key = captureKey(capture, settings, skyDistance)
    let at = held.get(capture.id)
    if (!at) {
      let layer = 0
      while (used.has(layer)) layer++
      if (layer >= capacity) continue
      used.add(layer)
      held.set(capture.id, (at = { key: '', layer, done: false }))
    }
    if (at.key !== key) due.push(capture)
  }
  return due
}

/** The host asks every capture again. */
export function recaptureAll(held: Map<string, CaptureHeld>) {
  for (const h of held.values()) h.key = ''
}
