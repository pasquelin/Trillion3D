import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** Per-pass receiver context, in world metres and physical pixels. */
export const SHADOW_VIEW_WGSL = wgslBlock(
  'SHADOW_VIEW_WGSL',
  [],
  `
var<private> shadowCamera:vec3f=vec3f(0.0);
var<private> shadowViewWidth:f32=0.0;
var<private> shadowAngularPixel:f32=0.0;
fn shadowSetView(camera:vec3f,width:f32,footprint:f32,centre:vec3f){
 shadowCamera=camera;shadowViewWidth=width;
 shadowAngularPixel=footprint/max(length(centre-camera),1e-6);
}`,
)
