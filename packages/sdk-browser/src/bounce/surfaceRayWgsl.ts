import { LIGHTS_IRRADIANCE_WGSL, lightsIrradianceWgsl } from '../lighting/direct/lightLoopWgsl.ts'
import { BOUNCE_LIGHT_CELL_WGSL } from './lightCellWgsl.ts'
import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { INVERSE_PI_BOUNCE } from '../../../math/src/wgsl/lighting.ts'

/** Posed hits read the surface cache, an atlas (`atlas.ts`) whose padding texels, never written,
 *  hold zero — what a texel past the cache returns. An owned leaf's hit evaluates the lighting at
 *  its owner's transformed centroid: no stale coowner cell, no owner-sized radiance allocation. */
const surfaceRayWgsl = (irradiance: WgslDecl[]) =>
  wgslBlock(
    `surfaceRayWgsl(${irradiance.map((d) => d.name).join(', ')})`,
    [INVERSE_PI_BOUNCE, ...irradiance],
    `
fn rayRadiance(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 let hit=traceProxy(origin,direction,reach);
 if(!hit.found){return vec4f(0.0,0.0,0.0,reach);}
 // The face that counts is the one looking at the ray: the proxy is two-sided by construction.
 let geometric=proxyOwnerNormal(hit.triangle,hit.owner);
 let face=select(0u,1u,dot(geometric,direction)>0.0);
 if(hit.owner!=PROXY_POSED){
  let normal=select(geometric,-geometric,face==1u);
  let point=proxyOwnerCentre(hit.triangle,hit.owner);
  let lighting=lightsIrradiance(point,normal,reach)+sampleBounce(point,normal);
  return vec4f(proxyOwnerAlbedo(hit.owner)*lighting*INVERSE_PI_BOUNCE,hit.distance);
 }
 let texel=hit.triangle*2u+face;
 let size=textureDimensions(surface);
 if(texel>=size.x*size.y){return vec4f(0.0,0.0,0.0,hit.distance);}
 return vec4f(textureLoad(surface,vec2u(texel%size.x,texel/size.x),0).rgb,hit.distance);
}`,
  )

/** A ray's radiance in a program without the world grid's lists (the reflections): every light. */
export const SURFACE_RAY_WGSL = surfaceRayWgsl([LIGHTS_IRRADIANCE_WGSL])
/** A probe ray's radiance (\`probeWgsl.ts\`): an owned leaf's hit walks its cell's lights. */
export const PROBE_RAY_WGSL = surfaceRayWgsl([lightsIrradianceWgsl(true), BOUNCE_LIGHT_CELL_WGSL])
