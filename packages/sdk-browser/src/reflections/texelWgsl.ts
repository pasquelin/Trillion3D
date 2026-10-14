import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HALF_MAX } from '../../../math/src/wgsl/constants.ts'
import { octDecode, octEncode } from '../../../math/src/wgsl/octahedral.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl } from './viewLayout.ts'
import { REFLECTED_WGSL } from './weight.ts'

/**
 * THE HALF GRIDS' TEXELS (`halfTexture.ts`) and the one test that two of them saw the same surface.
 * Every texel holds the radiance of both lobes — the base's and the clear coat's — as six halves in
 * `xyz`, the precision of the reflection target the resolve reads; its `w` word differs by kind:
 *
 * - a FRESH texel, the trace's and the spatial reuse's (`freshPack`): the hit's distance as a half
 *   (bits 0–15, `HALF_MAX` for a ray that met nothing near), the pixel of the 2×2 block traced (16–17),
 *   the spatial reuse's radius in half texels (18–19), and a valid bit (20), zero where no pixel of the
 *   block reflects;
 * - a HISTORY texel, the temporal accumulation's (`historyPack`): its surface's linear depth as a half
 *   (0–15), its normal on the octahedron, six bits an axis (16–27), and how many images it averages
 *   (28–31, `REFLECTION_HISTORY` at most), zero where none: it carries the surface it was traced on into
 *   the next image, whose surface buffer no longer holds it.
 *
 * `reflectionLinearDepth`: a clip point's depth that grows linearly along the view — its `w` under a
 * perspective, its `z` under an orthographic projection —, `surfaceLinearDepth` the one of a world
 * point in this view, and `reflectionDepthPixel` the depth a pixel's
 * footprint spans at it (`ReflectionView.slab`). `reflectionSameSurface`: how surely a texel of depth
 * `other` and normal `otherN` lies on the surface of depth `depth`, normal `N`, seen from `V`, `pixels`
 * pixels apart on the screen: one within the depth that surface spans across them — steeper as it turns
 * edge-on, `REFLECTION_GRAZING` at most —, nothing two such spans off, times the normals' agreement.
 * `historyGather`: the four history texels of `grid` around `q` (half-grid coordinates, texel centres
 * on the integers), bilinear, those that hold a history (`near`), and those weighed by the same-surface
 * test too (`sharp`), with their mean count — the one read of a history, the accumulation's of the
 * last image's grid, the upsample's of this image's.
 */
export const REFLECTION_TEXEL_WGSL = wgslBlock(
  'REFLECTION_TEXEL_WGSL',
  [
    REFLECTED_WGSL,
    HALF_MAX,
    octEncode,
    octDecode,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
  ],
  `fn texelReflected(t:vec4u)->Reflected{
 let a=unpack2x16float(t.x);
 let b=unpack2x16float(t.y);
 return Reflected(vec3f(a,b.x),vec3f(b.y,unpack2x16float(t.z)));
}
fn texelRadiance(r:Reflected)->vec3u{
 let b=min(r.base,vec3f(HALF_MAX));
 let c=min(r.coat,vec3f(HALF_MAX));
 return vec3u(pack2x16float(b.xy),pack2x16float(vec2f(b.z,c.x)),pack2x16float(c.yz));
}
fn texelHalf(x:f32)->u32{return pack2x16float(vec2f(min(x,HALF_MAX),0.0))&0xffffu;}
fn texelHalfOf(w:u32)->f32{return unpack2x16float(w&0xffffu).x;}
fn freshPack(r:Reflected,hit:f32,pick:u32,radius:u32)->vec4u{
 return vec4u(texelRadiance(r),texelHalf(hit)|((pick-1u)<<16u)|(radius<<18u)|(1u<<20u));
}
fn freshValid(t:vec4u)->bool{return (t.w&(1u<<20u))!=0u;}
fn freshPick(t:vec4u)->u32{return ((t.w>>16u)&3u)+1u;}
fn freshRadius(t:vec4u)->u32{return (t.w>>18u)&3u;}
fn freshHit(t:vec4u)->f32{return texelHalfOf(t.w);}
fn historyPack(r:Reflected,depth:f32,N:vec3f,count:u32)->vec4u{
 let e=vec2u(round((octEncode(N)*0.5+vec2f(0.5))*63.0));
 return vec4u(texelRadiance(r),texelHalf(depth)|(e.x<<16u)|(e.y<<22u)|(count<<28u));
}
fn historyCount(t:vec4u)->u32{return t.w>>28u;}
fn historyDepth(t:vec4u)->f32{return texelHalfOf(t.w);}
fn historyNormal(t:vec4u)->vec3f{
 let e=vec2f(f32((t.w>>16u)&63u),f32((t.w>>22u)&63u))/63.0;
 return octDecode(e*2.0-vec2f(1.0));
}
/** The view's pixel of the half texel \`at\` that its \`pick\` names. */
fn halfPixel(at:vec2i,pick:u32)->vec2i{
 return at*2+vec2i(i32((pick-1u)&1u),i32((pick-1u)>>1u));
}
fn reflectionLinearDepth(clip:vec4f)->f32{return select(clip.z,clip.w,reflectionView.slab.w!=0.0);}
fn surfaceLinearDepth(P:vec3f)->f32{return reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));}
fn reflectionDepthPixel(depth:f32)->f32{
 return select(reflectionView.slab.z,depth*reflectionView.slab.x,reflectionView.slab.w!=0.0);
}
fn reflectionSameSurface(depth:f32,N:vec3f,V:vec3f,other:f32,otherN:vec3f,pixels:f32)->f32{
 let c=max(dot(N,V),REFLECTION_GRAZING);
 let span=max(pixels,1.0)*reflectionDepthPixel(depth)*(1.0+sqrt(1.0-c*c)/c);
 let near=1.0-smoothstep(span,2.0*span,abs(other-depth));
 return near*pow(max(dot(N,otherN),0.0),REFLECTION_NORMAL_POWER);
}
struct HistoryGather{sharp:Reflected,sharpWeight:f32,near:Reflected,nearWeight:f32,count:f32,}
fn historyGather(grid:texture_2d<u32>,q:vec2f,depth:f32,N:vec3f,V:vec3f,pixels:f32)->HistoryGather{
 var g=HistoryGather(Reflected(vec3f(0.0),vec3f(0.0)),0.0,Reflected(vec3f(0.0),vec3f(0.0)),0.0,0.0);
 let corner=vec2i(floor(q));
 let f=q-floor(q);
 let last=vec2i(textureDimensions(grid))-vec2i(1);
 for(var k=0u;k<4u;k++){
  let o=vec2u(k&1u,k>>1u);
  let tap=corner+vec2i(o);
  if(any(tap<vec2i(0))||any(tap>last)){continue;}
  let t=textureLoad(grid,tap,0);
  if(historyCount(t)==0u){continue;}
  let r=texelReflected(t);
  let w=mix(1.0-f.x,f.x,f32(o.x))*mix(1.0-f.y,f.y,f32(o.y));
  g.near.base+=w*r.base;g.near.coat+=w*r.coat;g.nearWeight+=w;
  let e=w*reflectionSameSurface(depth,N,V,historyDepth(t),historyNormal(t),pixels);
  g.sharp.base+=e*r.base;g.sharp.coat+=e*r.coat;g.sharpWeight+=e;
  g.count+=e*f32(historyCount(t));
 }
 return g;
}`,
)
