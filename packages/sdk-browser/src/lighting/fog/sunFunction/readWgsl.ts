import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { SUN_FOG_VIEW_WGSL } from './viewWgsl.ts'

/** Where the volume's programs bind the sun's light function texture and its view block (`viewWgsl.ts`), and the name of the sampler
 *  they read it through. */
export interface SunFogBindings {
  readonly group: number
  readonly texture: number
  readonly view: number
  readonly samplerName: string
}

/**
 * THE SUN'S LIGHT FUNCTION AS THE VOLUME READS IT: the colour the sun gives at the world point P is its colour times
 * `fogSunFunctionOf(light, P)`. Where the atlas holds the sun's function and the setting `lightFunctionFog` is on
 * (`lightFunctionFogHolds`), it is the atlas's, as a local light's is; otherwise it is read from the texture drawn for the fog alone
 * (`sunFunction/frame.ts`): the point is taken to its place across the sun's direction over the sphere the texture covers, from 0 to 1
 * with the rows running down, and read bilinear and clamped to the edge, then faded to the disabled brightness over the last fifth of the
 * fade distance by the distance of that point from the eye, as the atlas's function is. White where the texture is not drawn this image (the sun
 * wears no function, or the view draws none).
 */
export const sunFogReadWgsl = (b: SunFogBindings, atlasRead: WgslDecl) =>
  wgslBlock(
    `sunFogReadWgsl(${b.group}, ${b.texture}, ${b.view})`,
    [SUN_FOG_VIEW_WGSL, atlasRead],
    `@group(${b.group}) @binding(${b.view}) var<uniform> fogSunView:SunFogView;
@group(${b.group}) @binding(${b.texture}) var fogSunFunction:texture_2d<f32>;
fn fogSunFunctionOf(light:DirectLight,P:vec3f)->vec3f{
 if(lightFunctionFogHolds(light)){return lightFunctionOf(light,P);}
 if(fogSunView.up.w<0.5){return vec3f(1.0);}
 let apart=P-fogSunView.centre.xyz;
 let across=vec2f(dot(apart,fogSunView.right.xyz),dot(apart,fogSunView.up.xyz))/fogSunView.centre.w;
 let uv=vec2f(0.5+0.5*across.x,0.5-0.5*across.y);
 let share=textureSampleLevel(fogSunFunction,${b.samplerName},uv,0.0).x;
 let alpha=saturate((fogSunView.fade.x-length(fogSunView.eye.xyz-P))/(fogSunView.fade.x*0.2));
 return vec3f(saturate(mix(fogSunView.fade.y,share,alpha)));
}`,
  )
