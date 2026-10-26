import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { keepsBeautyChain } from '../../visibility/shader/shadeMode.ts'

/**
 * True when the image must be lit by the declared lights. False in the only unlit view: `unlit`
 * requested by the host, or `auto` on a scene with no light — there, raw albedo comes out as-is.
 *
 * The light count does not enter the decision. An explicitly requested `lit` view lights even with
 * no light: the contract then outputs black, emissives kept, and that is the right answer — a scene
 * no source lights is black. Falling back to albedo made a room bright when the host had just turned
 * off all its lights, with no blackout showing.
 */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  return !rt.lights.store.unlit
}

/** Whether this image is the beauty one, its whole chain kept: the diagnostic view off, or a view
 *  of the lit image that keeps it (`keepsBeautyChain`), and no second-camera capture. */
export const beautyImage = (rt: Pick<WebgpuPagesRuntime, 'run' | 'capture'>) =>
  keepsBeautyChain(rt.run.diagnostic) && !rt.capture.capturing
