import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_ANGLE } from '../../../math/src/wgsl/constants.ts'
import { HALF_FORMAT } from './halfTexture.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'

/**
 * THE SPATIAL REUSE of a surface's fresh half grid (`spatialOpaque`, `spatialFront`), between the trace
 * and the temporal accumulation: a glossy texel — one whose lobe was sampled, its reuse radius above
 * zero (`freshRadius`, `traceHalf.ts`: ⌈`REFLECTION_REUSE_RADIUS` · roughness⌉ half texels) — averages
 * its ray with those of up to `REFLECTION_REUSE_TAPS` neighbours on a disc of that radius (a Vogel
 * spiral, turned by the golden angle every image), each weighed by how surely it traced the same
 * surface (`reflectionSameSurface`, on the depth and normal of the pixels both traced) and kept only
 * when it was sampled too. Neighbours on one surface see one lobe from nearly one point: their rays are
 * that lobe's samples, and the texel gains their count. A mirror's texel (radius zero) is copied as it
 * is: its reflection's detail is its own pixel's. The texel keeps its own word — its hit, its pick, its
 * radius —, which the accumulation reads.
 */
export const REFLECTION_SPATIAL_WGSL = wgslBlock(
  'REFLECTION_SPATIAL_WGSL',
  [REFLECTION_SURFACES_WGSL, REFLECTION_TEXEL_WGSL, GOLDEN_ANGLE],
  `@group(0) @binding(${B.spatialIn}) var spatialIn:texture_2d<u32>;
@group(0) @binding(${B.spatialOut}) var spatialOut:texture_storage_2d<${HALF_FORMAT},write>;
fn spatialTexel(at:vec2i,layer:u32)->vec4u{
 let centre=textureLoad(spatialIn,at,0);
 let radius=freshRadius(centre);
 if(!freshValid(centre)||radius==0u){return centre;}
 let coord=halfPixel(at,freshPick(centre));
 let P=surfacePointAt(layer,coord);
 let N=normalize(surfaceNormalAt(coord).xyz);
 let V=viewToEye(P);
 let depth=reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));
 let last=vec2i(textureDimensions(spatialIn))-vec2i(1);
 let turn=f32(reflectionView.temporal.x%REFLECTION_SEQUENCE)*GOLDEN_ANGLE;
 var sum=texelReflected(centre);
 var total=1.0;
 for(var k=0u;k<REFLECTION_REUSE_TAPS;k++){
  let a=turn+f32(k)*GOLDEN_ANGLE;
  let reach=f32(radius)*sqrt((f32(k)+0.5)/f32(REFLECTION_REUSE_TAPS));
  let tap=clamp(at+vec2i(round(reach*vec2f(cos(a),sin(a)))),vec2i(0),last);
  if(all(tap==at)){continue;}
  let t=textureLoad(spatialIn,tap,0);
  if(!freshValid(t)||freshRadius(t)==0u){continue;}
  let s=halfPixel(tap,freshPick(t));
  let other=reflectionLinearDepth(reflectionView.viewProj*vec4f(surfacePointAt(layer,s),1.0));
  let w=reflectionSameSurface(depth,N,V,other,normalize(surfaceNormalAt(s).xyz),distance(vec2f(s),vec2f(coord)));
  if(w<=0.0){continue;}
  let r=texelReflected(t);
  sum.base+=w*r.base;sum.coat+=w*r.coat;
  total+=w;
 }
 return vec4u(texelRadiance(Reflected(sum.base/total,sum.coat/total)),centre.w);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn spatialOpaque(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(spatialOut))){return;}
 textureStore(spatialOut,id.xy,spatialTexel(vec2i(id.xy),0u));
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn spatialFront(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(spatialOut))){return;}
 textureStore(spatialOut,id.xy,spatialTexel(vec2i(id.xy),1u));
}`,
)
