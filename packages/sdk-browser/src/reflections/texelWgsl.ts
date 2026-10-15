import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HALF_MAX } from '../../../math/src/wgsl/constants.ts'
import { bitIsSet, lowHalf } from '../../../math/src/wgsl/integer.ts'
import { octDecode, octEncode } from '../../../math/src/wgsl/octahedral.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl, reflectionLightViewWgsl } from './viewLayout.ts'
import { REFLECTED_WGSL } from './weight.ts'
import { ndcToUvUnflipped, slabPerspective } from '../../../math/src/wgsl/projection.ts'
import { unitToSigned2 } from '../../../math/src/wgsl/reals.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'

/**
 * THE GRIDS' TEXELS (`grids.ts`), a texel a pixel, and the one test that two of them saw the same
 * surface. Every texel holds the radiance of both lobes — the base's and the clear coat's — as six
 * halves in `xyz`, the precision of the reflection target the resolve reads; its `w` word differs by
 * kind:
 *
 * - a FRESH texel, the trace's and the spatial reuse's (`freshPack`): the hit's distance as a half
 *   (bits 0–15, `HALF_MAX` for a ray that met nothing near) and a valid bit (16), zero where the pixel
 *   does not reflect; its ray's direction beside it (`rayPack`, `REFLECTION_RAY_FORMAT`);
 * - a HISTORY texel, the temporal accumulation's (`historyPack`): its surface's linear depth as a half
 *   (0–15, never zero for a surface in front of the eye), its normal on the octahedron, five bits an
 *   axis (16–25, within 3° of it), and how many images it averages less one (26–31, `REFLECTION_STILL`
 *   at most); a zero depth where none: it carries the surface it was traced on into the next image,
 *   whose surface buffer no longer holds it.
 *
 * `reflectionLinearDepth`: a clip point's depth that grows linearly along the view — its `w` under a
 * perspective, its `z` under an orthographic projection —, `surfaceLinearDepth` the one of a world
 * point in this view, and `reflectionDepthPixel` the depth a pixel's
 * footprint spans at it (`ReflectionView.slab`). `reflectionSameSurface`: how surely a texel of depth
 * `other` and normal `otherN` lies on the surface of depth `depth`, normal `N`, seen from `V`, `pixels`
 * pixels apart on the screen: one within the depth that surface spans across them — steeper as it turns
 * edge-on, `REFLECTION_GRAZING` at most —, nothing two such spans off, times the normals' agreement:
 * whole within a normal map's tilt (`REFLECTION_CREASE_NEAR`), nothing across a crease
 * (`REFLECTION_CREASE_FAR`).
 *
 * THE DENOISER'S SPACE: every mean of radiance — the reuse's, the accumulation's, the last pass's — is
 * taken on `reflectionDenoised` radiance, c / (1 + L(c)·e / `REFLECTION_DENOISER_RANGE`), L the
 * luminance and e the view's exposure, and turned back by `reflectionLinear`: under the range a radiance
 * is itself, past it it weighs as the range, so one sample of a headlight in a lobe's tail is a bright
 * sample, not a thousandfold one that lights a block. `reflectionBounds`: the denoised fresh texels of
 * `grid` around `at` — a 5 × 5 window, its corners left out —, their mean ± `REFLECTION_CLAMP` standard
 * deviations; `reflectionClamped` a denoised radiance held within them (`temporalWgsl.ts`).
 * `historyGather`: the four history texels of `grid` around `q` (pixel coordinates, texel centres on
 * the integers), bilinear, each weighed by the same-surface test, with their mean count — the one read
 * of a history, the accumulation's of the last image's grid.
 */
export const REFLECTION_TEXEL_WGSL = wgslBlock(
  'REFLECTION_TEXEL_WGSL',
  [
    REFLECTED_WGSL,
    HALF_MAX,
    lowHalf,
    bitIsSet,
    slabPerspective,
    octEncode,
    octDecode,
    ndcToUvUnflipped,
    unitToSigned2,
    clampToExtent,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
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
fn texelHalf(x:f32)->u32{return lowHalf(pack2x16float(vec2f(min(x,HALF_MAX),0.0)));}
fn texelHalfOf(w:u32)->f32{return unpack2x16float(lowHalf(w)).x;}
fn freshPack(r:Reflected,hit:f32)->vec4u{return vec4u(texelRadiance(r),texelHalf(hit)|(1u<<16u));}
fn freshValid(t:vec4u)->bool{return bitIsSet(t.w,16u);}
fn freshHit(t:vec4u)->f32{return texelHalfOf(t.w);}
fn rayPack(d:vec3f)->u32{return pack2x16snorm(octEncode(d));}
fn rayDirection(w:u32)->vec3f{return octDecode(unpack2x16snorm(w));}
fn historyPack(r:Reflected,depth:f32,N:vec3f,count:u32)->vec4u{
 let e=vec2u(round(ndcToUvUnflipped(octEncode(N))*31.0));
 return vec4u(texelRadiance(r),texelHalf(depth)|(e.x<<16u)|(e.y<<21u)|((count-1u)<<26u));
}
fn historyCount(t:vec4u)->u32{return select(0u,(t.w>>26u)+1u,lowHalf(t.w)!=0u);}
fn historyDepth(t:vec4u)->f32{return texelHalfOf(t.w);}
fn historyNormal(t:vec4u)->vec3f{
 let e=vec2f(f32((t.w>>16u)&31u),f32((t.w>>21u)&31u))/31.0;
 return octDecode(unitToSigned2(e));
}
fn reflectionLinearDepth(clip:vec4f)->f32{return select(clip.z,clip.w,slabPerspective(reflectionView.slab));}
fn surfaceLinearDepth(P:vec3f)->f32{return reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));}
fn reflectionDepthPixel(depth:f32)->f32{
 return select(reflectionView.slab.z,depth*reflectionView.slab.x,slabPerspective(reflectionView.slab));
}
fn reflectionSameSurface(depth:f32,N:vec3f,V:vec3f,other:f32,otherN:vec3f,pixels:f32)->f32{
 let c=max(dot(N,V),REFLECTION_GRAZING);
 let span=max(pixels,1.0)*reflectionDepthPixel(depth)*(1.0+sqrt(1.0-c*c)/c);
 let near=1.0-smoothstep(span,2.0*span,abs(other-depth));
 return near*smoothstep(REFLECTION_CREASE_FAR,REFLECTION_CREASE_NEAR,dot(N,otherN));
}
fn reflectionLuma(c:vec3f)->f32{return dot(c,vec3f(0.2126,0.7152,0.0722));}
fn reflectionToneScale()->f32{return view.lightParams.w/REFLECTION_DENOISER_RANGE;}
fn reflectionDenoised(r:Reflected)->Reflected{
 let k=reflectionToneScale();
 return Reflected(r.base/(1.0+reflectionLuma(r.base)*k),r.coat/(1.0+reflectionLuma(r.coat)*k));
}
fn reflectionLinear(d:Reflected)->Reflected{
 let k=reflectionToneScale();
 return Reflected(d.base/max(1.0-reflectionLuma(d.base)*k,REFLECTION_EPSILON),
  d.coat/max(1.0-reflectionLuma(d.coat)*k,REFLECTION_EPSILON));
}
struct ReflectedBounds{low:Reflected,high:Reflected,}
fn reflectionBounds(grid:texture_2d<u32>,at:vec2i)->ReflectedBounds{
 var mean=Reflected(vec3f(0.0),vec3f(0.0));
 var square=mean;
 var n=0.0;
 let size=vec2i(textureDimensions(grid));
 for(var k=0;k<25;k++){
  let o=vec2i(k%5-2,k/5-2);
  if(abs(o.x)==2&&abs(o.y)==2){continue;}
  let t=textureLoad(grid,clampToExtent(at+o,size),0);
  if(!freshValid(t)){continue;}
  let d=reflectionDenoised(texelReflected(t));
  mean.base+=d.base;mean.coat+=d.coat;
  square.base+=d.base*d.base;square.coat+=d.coat*d.coat;
  n+=1.0;
 }
 let m=Reflected(mean.base/max(n,1.0),mean.coat/max(n,1.0));
 let s=Reflected(
  REFLECTION_CLAMP*sqrt(max(square.base/max(n,1.0)-m.base*m.base,vec3f(0.0))),
  REFLECTION_CLAMP*sqrt(max(square.coat/max(n,1.0)-m.coat*m.coat,vec3f(0.0))));
 return ReflectedBounds(Reflected(m.base-s.base,m.coat-s.coat),Reflected(m.base+s.base,m.coat+s.coat));
}
fn reflectionClamped(d:Reflected,b:ReflectedBounds)->Reflected{
 return Reflected(clamp(d.base,b.low.base,b.high.base),clamp(d.coat,b.low.coat,b.high.coat));
}
struct HistoryGather{radiance:Reflected,weight:f32,count:f32,}
fn historyGather(grid:texture_2d<u32>,q:vec2f,depth:f32,N:vec3f,V:vec3f,pixels:f32)->HistoryGather{
 var g=HistoryGather(Reflected(vec3f(0.0),vec3f(0.0)),0.0,0.0);
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
  let e=w*reflectionSameSurface(depth,N,V,historyDepth(t),historyNormal(t),pixels);
  g.radiance.base+=e*r.base;g.radiance.coat+=e*r.coat;g.weight+=e;
  g.count+=e*f32(historyCount(t));
 }
 return g;
}`,
)
