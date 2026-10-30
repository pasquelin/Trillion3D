import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { pixelToNdc, unprojectPoint } from '../../../../math/src/wgsl/projection.ts'

/** View uniform, shared by both programs and by the distortion: `viewport` carries the
 *  size, the raw-output flag of diagnostic views and the composition's sharpening strength; `lightParams` the contract light count, tiles in X and Y, and
 *  the scene's exposure, which the lighting reads in the units of the light it traces; `display.x` the rank of that curve
 *  (`../toneMappingWgsl.ts`), `display.yzw` the eye the fog is measured from; `jitter` the TAA's
 *  (`viewJitterWords`, `jitterWords.ts`); `source` the composition's image: its pixels per display
 *  pixel on each axis (`xy`), and its last pixel (`zw`) (`view.ts`, `writeSource`); `views` the
 *  lighting term a view of the lit image shows in place of the surface (`x`, `LIT_VIEWS`,
 *  `../../visibility/shader/shadeMode.ts`, `writeLightView`; `y` how the ambient occlusion applies, 0 none,
 *  1 to the emission and the sky light, 2 to the screen probes' light, and `z` the share it applies at,
 *  `writeAmbientOcclusion`; `w` the shading models' switches, bit 0 an eye's iris with
 *  a normal of its own, bit 1 a clear coat with a bottom normal, `writeModelSwitches`); `preExposure` the number every light is written multiplied
 *  by (`x`, `../../post/exposure/pre.ts`) and the scale the composition multiplies the image by
 *  (`y`): the exposure over that number, the scene's, or the one an automatic exposure measured
 *  and copied there on the GPU (`../../post/exposure/frame.ts`; `z` whether the image carries an alpha channel, 1 or 0 (`propagateAlpha`); `w` the distance at which a subsurface-model surface's colour is the light's transmittance, `writeSubsurfaceDistance`); `screenProbes` how the resolve reads the screen probes' history: `x` the strength of their short-range occlusion
 *  on a foliage pixel (a thin two-sided or subsurface-model surface), applied after the
 *  multi-bounce and the intensity to the diffuse alone, `y` the albedo the multi-bounce caps,
 *  `z` the intensity of their short-range occlusion and `w` their mode (bit 0 their occlusion alone over the
 *  world's probes' light, bit 1 no back light gathered, bit 2 the integration applied the short-range occlusion already, which the
 *  lighting then leaves as it is; `writeScreenProbes`); `surface` the surfaces' render pixels per display
 *  pixel on each axis (`xy`) and their last pixel (`zw`), where the composition reads a debug view's
 *  as-is pixel (`view.ts`, `writeSource`); `viewProjection` the matrix the surfaces were drawn with, the
 *  inverse of `inverseViewProjection`'s, which the contact shadows' rays project by; `contact` the camera's
 *  forward axis (`xyz`, unit) and the tangent of half its vertical field (`w`, 1 under an orthographic
 *  camera) (`writeContactShadows`); `reflection` the look of the light a surface reflects, the contrast it is raised to about the mid grey (`x`) and the
 *  scale it is multiplied by (`y`), before the environment BRDF weighs it (`writeReflectionLook`; `zw` unused). The environment's irradiance and fog travel with the lights. */
export const VIEW_LAYOUT = fieldLayout('View', [
  ['inverseViewProjection', 'mat4x4f'],
  ['camera', 'vec4f'],
  ['viewport', 'vec4f'],
  ['background', 'vec4f'],
  ['lightParams', 'vec4f'],
  ['display', 'vec4f'],
  ['jitter', 'vec4f'],
  ['source', 'vec4f'],
  ['views', 'vec4f'],
  ['preExposure', 'vec4f'],
  ['screenProbes', 'vec4f'],
  ['surface', 'vec4f'],
  ['viewProjection', 'mat4x4f'],
  ['contact', 'vec4f'],
  ['reflection', 'vec4f'],
] as const)
export const VIEW_WGSL = wgslBlock('VIEW_WGSL', [], VIEW_LAYOUT.wgsl)
/** World position of a pixel at a depth, reconstructed through that view: the one reading of
 *  the depth buffer every fullscreen pass shares. \`viewToEye\` is the direction from a point to the
 *  eye (the view direction, \`camera.w\` 0, under an orthographic camera): the one reading of the
 *  camera every lit pass shares. \`viewEyeDistance\` is the distance of a point from the eye, in metres: its straight
 *  distance, or, under an orthographic camera, where a point's distance from the eye has no meaning, its distance
 *  from the plane of the eye along the view direction (its depth). */
export const WORLD_AT_WGSL = wgslBlock(
  'WORLD_AT_WGSL',
  [VIEW_WGSL, pixelToNdc, unprojectPoint],
  `
fn worldAt(pixel:vec2f,z:f32)->vec3f{
 return unprojectPoint(view.inverseViewProjection,vec3f(pixelToNdc(pixel,view.viewport.xy),z));
}
fn viewToEye(P:vec3f)->vec3f{return normalize(view.camera.xyz-P*view.camera.w);}
fn viewEyeDistance(P:vec3f)->f32{
 if(view.camera.w!=0.0){return length(P-view.camera.xyz);}
 return abs(dot(P-view.display.yzw,normalize(view.camera.xyz)));
}`,
)

/** The ray through a pixel of a display of `size` and where it starts: the eye under a perspective camera; under an orthographic one (camera.w 0) the view direction, from the point of the plane through the eye the pixel falls on. */
export const VIEW_RAY_WGSL = wgslBlock(
  'VIEW_RAY_WGSL',
  [VIEW_WGSL, pixelToNdc, unprojectPoint],
  `
fn viewEye()->vec3f{return select(view.display.yzw,view.camera.xyz,view.camera.w!=0.0);}
fn viewRay(pixel:vec2f,size:vec2f)->vec3f{
 if(view.camera.w==0.0){return -normalize(view.camera.xyz);}
 let on=unprojectPoint(view.inverseViewProjection,vec3f(pixelToNdc(pixel,size),0.5));
 return normalize(on-view.camera.xyz);
}
fn viewRayStart(pixel:vec2f,size:vec2f)->vec3f{
 if(view.camera.w!=0.0){return view.camera.xyz;}
 let on=unprojectPoint(view.inverseViewProjection,vec3f(pixelToNdc(pixel,size),0.5));
 let forward=viewRay(pixel,size);
 return on-forward*dot(on-view.display.yzw,forward);
}`,
)
