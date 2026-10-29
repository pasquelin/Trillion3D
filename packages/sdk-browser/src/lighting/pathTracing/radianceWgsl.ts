import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PT_STATE_WGSL } from './pathWgsl.ts'
import { PT_VIEW_WGSL } from './viewWgsl.ts'

/**
 * THE LIGHT A PATH ADDS (`ptAccumulate(path, rgb, camera)`): `rgb` under the pre-exposure the accumulation was begun with, held to the brightest a path off the camera's ray adds
 * (`pathTracingMaxPathIntensity`, a half float for the camera's own).
 */
export const PT_RADIANCE_WGSL = wgslBlock(
  'PT_RADIANCE_WGSL',
  [PT_VIEW_WGSL, PT_STATE_WGSL],
  `fn ptAccumulate(path:ptr<function,PtPath>,rgb:vec3f,camera:bool){
 let r=rgb*ptView.eye.w;
 let most=select(ptView.limits.x,65504.0,camera);
 let adjust=most/max(max(most,r.x),max(r.y,r.z));
 (*path).radiance+=r*adjust;
}`,
)
