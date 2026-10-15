import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HALF_MAX } from '../../../math/src/wgsl/constants.ts'
import { bitIsSet, lowHalf } from '../../../math/src/wgsl/integer.ts'
import { octDecode, octEncode } from '../../../math/src/wgsl/octahedral.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl } from './viewLayout.ts'
import { REFLECTED_WGSL } from './weight.ts'
import { ndcToUvUnflipped, slabPerspective } from '../../../math/src/wgsl/projection.ts'
import { unitToSigned2 } from '../../../math/src/wgsl/reals.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'

/** The gather `name` (`historyGather`): with `near`, the bilinear sum of the held taps too — the
 *  upsample's fallback alone reads it, so the accumulation's gather adds none. One text, both. */
const historyGatherFn = (name: string, near: boolean) =>
  `fn ${name}(grid:texture_2d<u32>,q:vec2f,depth:f32,N:vec3f,V:vec3f,pixels:f32)->HistoryGather{
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
  let w=mix(1.0-f.x,f.x,f32(o.x))*mix(1.0-f.y,f.y,f32(o.y));${
    near ? '\n  g.near.base+=w*r.base;g.near.coat+=w*r.coat;g.nearWeight+=w;' : ''
  }
  let e=w*reflectionSameSurface(depth,N,V,historyDepth(t),historyNormal(t),pixels);
  g.sharp.base+=e*r.base;g.sharp.coat+=e*r.coat;g.sharpWeight+=e;
  g.count+=e*f32(historyCount(t));
 }
 return g;
}`

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
 * (`REFLECTION_CREASE_FAR`). `reflectionBounds`: the radiance the fresh texels of `grid` around `at`
 * hold, its mean ± `REFLECTION_CLAMP` standard deviations, taken in a perceptual space — each channel
 * c as c / (1 + c), where a firefly's thousandfold radiance is no more than a bright one's —, and
 * `reflectionClamped` a radiance held within them: the one rule that holds a sample or a history to
 * its neighbourhood (`spatialWgsl.ts`, `temporalWgsl.ts`).
 * `historyGather`: the four history texels of `grid` around `q` (half-grid coordinates, texel centres
 * on the integers), bilinear, those that hold a history (`near`), and those weighed by the same-surface
 * test too (`sharp`), with their mean count — the one read of a history, the accumulation's of the
 * last image's grid, the upsample's of this image's (`historyGatherNear`, the only reader of `near`).
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
fn freshPack(r:Reflected,hit:f32,pick:u32,radius:u32)->vec4u{
 return vec4u(texelRadiance(r),texelHalf(hit)|((pick-1u)<<16u)|(radius<<18u)|(1u<<20u));
}
fn freshValid(t:vec4u)->bool{return bitIsSet(t.w,20u);}
fn freshPick(t:vec4u)->u32{return ((t.w>>16u)&3u)+1u;}
fn freshRadius(t:vec4u)->u32{return (t.w>>18u)&3u;}
fn freshHit(t:vec4u)->f32{return texelHalfOf(t.w);}
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
/** The view's pixel of the half texel \`at\` that its \`pick\` names; \`halfPoint\` maps a point of the
 *  view's pixels to the half grid's (texel centres on the integers), \`halfCentre\` the half texel
 *  \`at\`'s centre back to the view's pixels. */
fn halfPixel(at:vec2i,pick:u32)->vec2i{
 return at*2+vec2i(i32((pick-1u)&1u),i32((pick-1u)>>1u));
}
fn halfPoint(pixel:vec2f)->vec2f{return pixel*0.5-vec2f(0.5);}
fn halfCentre(at:vec2i)->vec2f{return vec2f(at*2+vec2i(1));}
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
struct ReflectedBounds{low:Reflected,high:Reflected,}
fn reflectionPerceived(c:vec3f)->vec3f{return c/(vec3f(1.0)+c);}
fn reflectionLinear(p:vec3f)->vec3f{let q=clamp(p,vec3f(0.0),vec3f(0.999));return q/(vec3f(1.0)-q);}
fn reflectionBounds(grid:texture_2d<u32>,at:vec2i)->ReflectedBounds{
 var mean=Reflected(vec3f(0.0),vec3f(0.0));
 var square=mean;
 var n=0.0;
 let size=vec2i(textureDimensions(grid));
 for(var k=0;k<9;k++){
  let t=textureLoad(grid,clampToExtent(at+vec2i(k%3-1,k/3-1),size),0);
  if(!freshValid(t)){continue;}
  let r=texelReflected(t);
  let b=reflectionPerceived(r.base);let c=reflectionPerceived(r.coat);
  mean.base+=b;mean.coat+=c;
  square.base+=b*b;square.coat+=c*c;
  n+=1.0;
 }
 let m=Reflected(mean.base/max(n,1.0),mean.coat/max(n,1.0));
 let s=Reflected(
  REFLECTION_CLAMP*sqrt(max(square.base/max(n,1.0)-m.base*m.base,vec3f(0.0))),
  REFLECTION_CLAMP*sqrt(max(square.coat/max(n,1.0)-m.coat*m.coat,vec3f(0.0))));
 return ReflectedBounds(
  Reflected(reflectionLinear(m.base-s.base),reflectionLinear(m.coat-s.coat)),
  Reflected(reflectionLinear(m.base+s.base),reflectionLinear(m.coat+s.coat)));
}
fn reflectionClamped(r:Reflected,b:ReflectedBounds)->Reflected{
 return Reflected(clamp(r.base,b.low.base,b.high.base),clamp(r.coat,b.low.coat,b.high.coat));
}
struct HistoryGather{sharp:Reflected,sharpWeight:f32,near:Reflected,nearWeight:f32,count:f32,}
${historyGatherFn('historyGather', false)}
${historyGatherFn('historyGatherNear', true)}`,
)
