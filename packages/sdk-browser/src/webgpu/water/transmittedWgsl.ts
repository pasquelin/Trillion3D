import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ndcToPixel, perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
/**
 * What the water composite reads through its surface (`compositeWgsl.ts`): the frozen backdrop at
 * the exit of the refracted ray, attenuated over the path the ray travels in the volume. The host
 * declares the views, the backdrop and its depth, `worldAt` and `volumeTransmittance`.
 */
export const WATER_TRANSMITTED_WGSL = wgslBlock(
  'WATER_TRANSMITTED_WGSL',
  [ndcToPixel, perspectiveDivide],
  `// Pixel where the ray from P along dir, advanced by dist, lands; the straight pixel when it
// leaves the frustum.
fn exitPixel(P:vec3f,dir:vec3f,dist:f32,straight:vec2i,size:vec2f)->vec2i{
 let clipPos=uni.viewProj*vec4f(P+dir*dist,1.0);
 if(clipPos.w<=0.0){return straight;}
 let ndc=perspectiveDivide(clipPos).xy;
 return vec2i(clamp(ndcToPixel(ndc,size),vec2f(0.0),size-vec2f(1.0)));
}
// Distance from P to the backdrop at a pixel, or the declared thickness when nothing was drawn.
fn backdropDistance(P:vec3f,pixel:vec2i,thickness:f32)->f32{
 let z=textureLoad(backdropDepth,pixel,0);
 return select(thickness,distance(P,worldAt(vec2f(pixel)+vec2f(0.5),z)),z>0.0);
}
struct Transmitted{color:vec3f,coverage:f32,}
fn transmittedBackdrop(vol:Volume,P:vec3f,N:vec3f,V:vec3f,straight:vec2i,fragZ:f32)->Transmitted{
 let size=view.viewport.xy;
 // The volume ends where the opaque scene begins: the ray travels the declared thickness, or the
 // distance to the backdrop under this pixel when that is shorter. A block just below the surface
 // is displaced and tinted by its own depth, not by the basin's.
 let path=min(vol.thickness,backdropDistance(P,straight,vol.thickness));
 let refracted=refract(-V,N,vol.eta);
 var chosen=straight;
 if(dot(refracted,refracted)>1e-8&&path>0.0){
  let exit=exitPixel(P,normalize(refracted),path,straight,size);
  // A sample whose depth places it in front of the surface would show an object in front of the
  // water: the straight sample is read instead. Depth is reversed, so "behind" is "smaller".
  chosen=select(straight,exit,textureLoad(backdropDepth,exit,0)<=fragZ);
 }
 let sample=textureLoad(backdrop,chosen,0);
 return Transmitted(sample.rgb*volumeTransmittance(vol.attenuation.rgb,path),sample.a);
}`,
)
