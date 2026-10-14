import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { SHARED_EXPONENT_WGSL } from '../bounce/sharedExponentWgsl.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { HALF_TEXEL_WGSL } from './halfTexture.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { reflectionWeighWgsl } from './weight.ts'

/**
 * THE UPSAMPLE, edge-aware: each full-resolution pixel of a reflecting surface reads the four half texels
 * nearest it (`upsampled`), bilinear by its place among their centres, each weighed by whether it saw the
 * same surface — its traced pixel's point within `REFLECTION_UPSAMPLE_PLANE` pixels of this pixel's
 * tangent plane, and its normal within the pixel's (`REFLECTION_UPSAMPLE_NORMAL`) —, so that a reflection
 * never bleeds across a silhouette or a crease. The pixel's own half texel traced a pixel of its own
 * surface in its 2×2 block, so one of the four is always of the pixel's surface; where none passes both
 * tests (a surface a pixel thin), the bilinear mean of the texels that traced a pixel answers.
 *
 * `upsampleOpaque` weighs the radiance on the pixel's own reflectance, normal, roughness and lobes
 * (`reflectionShare`) — the texture detail of a surface is the pixel's, never the half grid's — into the
 * reflection target the resolve reads (`resolvedReflectionWgsl`). `upsampleFront` writes the front
 * surface's radiance where the forward fragments read it, one load (`forwardTrace`). A pixel that does not
 * reflect writes nothing, and nothing reads it.
 */
export const REFLECTION_UPSAMPLE_WGSL = wgslBlock(
  'REFLECTION_UPSAMPLE_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    HALF_TEXEL_WGSL,
    reflectionWeighWgsl(true),
    SHARED_EXPONENT_WGSL,
    surfaceReflects,
    f0Of,
  ],
  `@group(0) @binding(${B.half}) var halfIn:texture_2d<u32>;
@group(0) @binding(${B.frontHalf}) var frontHalfIn:texture_2d<u32>;
@group(0) @binding(${B.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${B.target}) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(${B.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
fn halfLoad(layer:u32,at:vec2i)->vec4u{
 if(layer==0u){return textureLoad(halfIn,at,0);}
 return textureLoad(frontHalfIn,at,0);
}
fn halfLast(layer:u32)->vec2i{
 if(layer==0u){return vec2i(textureDimensions(halfIn))-vec2i(1);}
 return vec2i(textureDimensions(frontHalfIn))-vec2i(1);
}
/** The radiance the surface \`layer\` reflects at pixel \`coord\`, its point \`P\` and normal \`N\`. */
fn upsampled(layer:u32,coord:vec2i,P:vec3f,N:vec3f)->Reflected{
 let q=(vec2f(coord)+vec2f(0.5))*0.5-vec2f(0.5);
 let corner=vec2i(floor(q));
 let f=q-floor(q);
 let last=halfLast(layer);
 let tolerance=REFLECTION_UPSAMPLE_PLANE*(reflectionView.viewProj*vec4f(P,1.0)).w*reflectionView.slab.x;
 var sharp=Reflected(vec3f(0.0),vec3f(0.0));
 var near=sharp;
 var sharpWeight=0.0;
 var nearWeight=0.0;
 for(var k=0u;k<4u;k++){
  let o=vec2u(k&1u,k>>1u);
  let at=clamp(corner+vec2i(o),vec2i(0),last);
  let t=halfLoad(layer,at);
  if(t.w==0u){continue;}
  let r=halfReflected(t);
  let w=mix(1.0-f.x,f.x,f32(o.x))*mix(1.0-f.y,f.y,f32(o.y));
  near.base+=w*r.base;near.coat+=w*r.coat;nearWeight+=w;
  let s=halfPixel(at,t.w);
  let apart=abs(dot(surfacePointAt(layer,s)-P,N));
  let facing=max(dot(normalize(surfaceNormalAt(layer,s).xyz),N),0.0);
  let e=w*(1.0-smoothstep(0.0,tolerance,apart))*pow(facing,REFLECTION_UPSAMPLE_NORMAL);
  sharp.base+=e*r.base;sharp.coat+=e*r.coat;sharpWeight+=e;
 }
 if(sharpWeight>REFLECTION_EPSILON){return Reflected(sharp.base/sharpWeight,sharp.coat/sharpWeight);}
 let n=max(nearWeight,1e-30);
 return Reflected(near.base/n,near.coat/n);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn upsampleOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let coord=vec2i(id.xy);
 let flags=surfaceFlagsAt(0u,coord);
 if(!surfaceReflects(flags)){return;}
 let P=surfacePointAt(0u,coord);
 let normal=surfaceNormalAt(0u,coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(surfaceLobesAt(0u,coord),1.0,N,V,normal.a);}
 let base=textureLoad(traceBase,coord,0);
 let share=reflectionShare(upsampled(0u,coord,P,N),f0Of(base.rgb,base.a),normal.a,N,V);
 textureStore(traceOut,coord,vec4f(share,1.0));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn upsampleFront(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 let coord=vec2i(id.xy);
 if(!surfaceReflects(surfaceFlagsAt(1u,coord))){return;}
 let traced=upsampled(1u,coord,surfacePointAt(1u,coord),normalize(surfaceNormalAt(1u,coord).xyz));
 textureStore(frontOut,coord,vec4u(rtPackShared(traced.base),rtPackShared(traced.coat),0u,0u));
}`,
)
