import { SUBSURFACE_FLAG } from '../../scene/subsurface.ts';
import { AS_IS_FLAG, FOG_FREE_SURFACE_FLAG, SURFACE_MODEL_MASK } from '../../scene/surfaceModel.ts';
import { PIXEL_FOOTPRINT_WGSL } from './footprintWgsl.ts';

/** The lighting's entry, its camera fog and its mirror term: the texts the reflection source
 *  output finds in it (`reflections/sourceOutputWgsl.ts`). */
export const LIGHT_SURFACE_ENTRY =
  '@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{';
export const CAMERA_FOG_WGSL = `if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}`;
export const MIRROR_TERM_WGSL = '+mirrorLighting(base.rgb,base.a,normal.a,N,V,P)';

/**
 * What a shadow read needs of its pixel, set only where its tile lists a shadowed light
 * (`pixelShadowed`, #1369) — nothing else reads it, and a pixel of any other tile, or of the program
 * with no shadow code, loads none of its eight neighbour depths nor its receiver offset: its footprint
 * and point unjittered, whence its shadow level (#1363); the turn of the shadow filters' taps this
 * jitter phase, and the taps a moving image takes (`shadowTapsOf`); a lane in the target asks per
 * subgroup; its receiver, moved by its shading-point offset.
 */
const SHADOW_SETUP_WGSL = `fn shadowSetup(coord:vec2i,pixel:vec4f,z:f32,P:vec3f){
 let level=pixelLevel(coord,pixel.xy,z,P);shadowFootprint=level.footprint;shadowUnjitter=level.unjitter;
 shadowRotation=view.jitter.zw;shadowRequesting=all(vec2u(pixel.xy)<textureDimensions(depth));
 shadowTaps=shadowTapsOf(u32(view.viewport.w));
 let receiverAt=(u32(pixel.y)*u32(view.viewport.x)+u32(pixel.x))*3u;
 shadowReceiverOffset=vec3f(shadingOffset[receiverAt],shadingOffset[receiverAt+1u],shadingOffset[receiverAt+2u]);
}`;

export const contractSurfaceBody = (bounce: string, diagnostic = '') => `${PIXEL_FOOTPRINT_WGSL}
${SHADOW_SETUP_WGSL}
${LIGHT_SURFACE_ENTRY}
 let coord=vec2i(pixel.xy);let surfaceFlag=textureLoad(flags,coord,0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 if(flag==0u){return vec4f(0.0);}
 let base=textureLoad(baseMetal,coord,0);
 if(flag==${AS_IS_FLAG}u){return vec4f(base.rgb,1.0);}
 let z=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,z);
 if(flag==1u){var rgb=base.rgb;${CAMERA_FOG_WGSL}return vec4f(rgb,1.0);}
 let normal=textureLoad(normalRough,coord,0);let emissive=textureLoad(emissiveAo,coord,0);
 if(pixelShadowed(pixel.xy)){shadowSetup(coord,pixel,z,P);}
 let V=normalize(view.camera.xyz-P*view.camera.w);let N=normalize(normal.xyz);
 surfaceModel=flag;
 thinSubsurface=vec3f(0.0);
 if((surfaceFlag&${SUBSURFACE_FLAG}u)!=0u){thinSubsurface=textureLoad(subsurfaceColor,coord,0).rgb;}
 ${diagnostic}
 let lit=contractLighting(base.rgb,base.a,normal.a,N,V,P,emissive.a,pixel.xy);
 var ambient=environmentLighting(base.rgb,base.a,N,emissive.a);
 if(any(thinSubsurface>vec3f(0.0))){ambient+=environmentLighting(thinSubsurface,0.0,-N,emissive.a);}
 var rgb=lit+ambient+emissive.rgb${bounce};${CAMERA_FOG_WGSL}
 return vec4f(rgb,1.0);
}`;
