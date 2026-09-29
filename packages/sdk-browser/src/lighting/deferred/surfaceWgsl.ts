import { SUBSURFACE_FLAG } from '../../scene/subsurface.ts';
import { AS_IS_FLAG, FOG_FREE_SURFACE_FLAG, SURFACE_MODEL_MASK } from '../../scene/surfaceModel.ts';

export const contractSurfaceBody = (bounce: string, diagnostic = '') => `
@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);let surfaceFlag=textureLoad(flags,coord,0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 if(flag==0u){return vec4f(0.0);}
 let base=textureLoad(baseMetal,coord,0);
 if(flag==${AS_IS_FLAG}u){return vec4f(base.rgb,1.0);}
 let z=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,z);
 if(flag==1u){var rgb=base.rgb;if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}return vec4f(rgb,1.0);}
 let normal=textureLoad(normalRough,coord,0);let emissive=textureLoad(emissiveAo,coord,0);
 // Its footprint at its depth, the unit of its shadow level; a lane in the target asks per subgroup.
 shadowFootprint=length(worldAt(pixel.xy+vec2f(1.0,0.0),z)-P);shadowRequesting=all(vec2u(pixel.xy)<textureDimensions(depth));
 let V=normalize(view.camera.xyz-P*view.camera.w);let N=normalize(normal.xyz);
 surfaceModel=flag;
 thinSubsurface=vec3f(0.0);
 if((surfaceFlag&${SUBSURFACE_FLAG}u)!=0u){thinSubsurface=textureLoad(subsurfaceColor,coord,0).rgb;}
 ${diagnostic}
 let receiverAt=(u32(pixel.y)*u32(view.viewport.x)+u32(pixel.x))*3u;
 shadowReceiverOffset=vec3f(shadingOffset[receiverAt],shadingOffset[receiverAt+1u],shadingOffset[receiverAt+2u]);
 let lit=contractLighting(base.rgb,base.a,normal.a,N,V,P,emissive.a,pixel.xy);
 var ambient=environmentLighting(base.rgb,base.a,N,emissive.a);
 if(any(thinSubsurface>vec3f(0.0))){ambient+=environmentLighting(thinSubsurface,0.0,-N,emissive.a);}
 var rgb=lit+ambient+emissive.rgb${bounce};if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}
 return vec4f(rgb,1.0);
}`;
