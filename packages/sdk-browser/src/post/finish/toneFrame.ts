import { environmentCurve } from '../../../../sdk-core/src/scene/core/environment.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { askToneBake } from '../../lighting/toneLut.ts'
import { showsRaw } from '../../visibility/shader/shadeMode.ts'
import { colorGradingSettings } from './settings.ts'

/** Whether the view's lit colour goes through the tone table: lit by declared lamps, and not shown
 *  in raw values. */
const tableWanted = (rt: WebgpuPagesRuntime) =>
  wantsContractLighting(rt) && !showsRaw(rt.run.diagnostic)

/** Asks the table's baking program of `device` off the frame once a lit image needs it — the
 *  lighting that composes it is made —, the frame held until it landed
 *  (`../../frame/loop/framePipelines.ts`). */
export function askToneTable(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.gpu.deferred && wantsContractLighting(rt)) askToneBake(device)
}

/** Whether the tone table, once baked, differs from what the settings and the scene's display curve
 *  ask now, so a view that rests is drawn again (`../../frame/loop/unsettled.ts`). A table never
 *  baked — a view whose passes after the lighting are off — has nothing to be drawn again for. */
export function toneMoving(rt: WebgpuPagesRuntime) {
  const lut = rt.gpu.deferred?.toneLut
  if (!lut?.baked || !tableWanted(rt)) return false
  return lut.moving(colorGradingSettings(rt), environmentCurve(rt.lights.store.environment))
}

/**
 * Bakes the tone table again into the frame's encoder when its settings or the scene's display
 * curve changed since the last baking, before anything reads it: the composition, and the
 * transparents drawn on display values, which copy its words (`createToneLut`). Nothing for a view
 * the lighting does not light: no pass reads a table there. A view shown in raw values bakes too —
 * the composition reads none, but its layers do and the bake is made only where a setting moved.
 */
export function encodeToneTable(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const lut = rt.gpu.deferred?.toneLut
  if (!lut || !wantsContractLighting(rt)) return
  lut.encode(encoder, colorGradingSettings(rt), environmentCurve(rt.lights.store.environment))
}
