import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HALF_MAX } from '../../../../math/src/wgsl/constants.ts'
import { lowHalf } from '../../../../math/src/wgsl/integer.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl, reflectionLightViewWgsl } from './viewLayout.ts'
import { slabPerspective } from '../../../../math/src/wgsl/projection.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'

/**
 * THE TEXELS OF THE REFLECTIONS' TEXTURES (`grids.ts`), two words each, and the one test that two
 * pixels saw the same surface. A texel holds the radiance of the lobe a pixel traces — its top layer's,
 * the clear coat's where it carries one, the base's elsewhere, one lobe a pixel, the sharpest it
 * shows — as three halves, `x` and the low half of `y`; the high
 * half of `y` differs by kind:
 *
 * - a FRESH texel, the trace's (`freshPack`) and the resolve's: the hit's distance as a half (bits
 *   0–14, `HALF_MAX` for a ray that met nothing near) under a valid bit (15, the half's sign, a
 *   distance never negative), zero where the pixel casts or resolves nothing; a traced texel's ray
 *   beside it (`rayPack`, `REFLECTION_RAY_FORMAT`): the block's pixel the classification picked (bits
 *   0–4, a traced bit over its rank in the block) and the ray's direction on the octahedron, 13 bits an
 *   axis (5–17, 18–30, within 0.02° of it);
 * - a HISTORY texel, four words (`REFLECTION_HISTORY_FORMAT`), the temporal accumulation's
 *   (`historyPack`): the radiance's two words, the high half of `y` its surface's linear depth as a
 *   half — within 0.05 % of itself, under the history's distance threshold
 *   (`REFLECTION_HISTORY_DISTANCE`), zero where none, as the clear writes it: it carries the surface
 *   it was resolved on into the next image, whose depth no longer holds it —, `z` the second moment of
 *   its luminance in the denoiser's space (`historyMoment`), `w` how many images it averages, not
 *   rounded (`historyCount`, `REFLECTION_HISTORY` at most), each an `f32`'s bits.
 *
 * `reflectionLinearDepth`: a clip point's depth that grows linearly along the view — its `w` under a
 * perspective, its `z` under an orthographic projection —, `surfaceLinearDepth` the one of a world
 * point in this view, and `reflectionDepthPixel` the depth a pixel's footprint spans at it
 * (`ReflectionView.slab`). `reflectionSameSurface`: how surely a pixel of depth `other` and normal
 * `otherN` lies on the surface of depth `depth`, normal `N`, `pixels` pixels apart on the screen: one
 * within the depth that surface spans across them — a pixel's depth times its steepening as it turns
 * edge-on from `V`, `REFLECTION_GRAZING` at most (`reflectionSurfaceSpan`, once a pixel for all its
 * neighbours) —, nothing two such spans off, times the normals' agreement: whole
 * within a normal map's tilt (`REFLECTION_CREASE_NEAR`), nothing across a crease
 * (`REFLECTION_CREASE_FAR`).
 *
 * THE DENOISER'S SPACE: every mean of radiance — the resolve's, the accumulation's, the last pass's — is
 * taken on `reflectionDenoised` radiance, c / (1 + L(c)·e / `REFLECTION_DENOISER_RANGE`), L the
 * luminance and e the view's exposure, and turned back by `reflectionLinear`: under the range a radiance is itself, past it it weighs as the
 * range, so one sample of a headlight in a lobe's tail is a bright sample, not a thousandfold one that
 * lights a block.
 */
export const REFLECTION_TEXEL_WGSL = wgslBlock(
  'REFLECTION_TEXEL_WGSL',
  [
    HALF_MAX,
    lowHalf,
    slabPerspective,
    octEncode,
    octDecode,
    luminance,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
  ],
  `fn texelRadiance(t:vec2u)->vec3f{return vec3f(unpack2x16float(t.x),unpack2x16float(t.y).x);}
/** A texel's words: the radiance \`r\`, held to the halves' range, and the high half \`high\`. */
fn texelWords(r:vec3f,high:u32)->vec4u{
 let c=min(r,vec3f(HALF_MAX));
 return vec4u(pack2x16float(c.xy),lowHalf(pack2x16float(vec2f(c.z,0.0)))|(high<<16u),0u,0u);
}
fn texelHalf(x:f32)->u32{return lowHalf(pack2x16float(vec2f(min(x,HALF_MAX),0.0)));}
fn texelHalfOf(w:u32)->f32{return unpack2x16float(lowHalf(w)).x;}
/** A distance stored as a half (\`texelHalf\`): past \`HALF_MAX\`, the far one. */
fn texelDistanceOf(w:u32)->f32{
 let x=texelHalfOf(w);
 return select(x,REFLECTION_FAR,x>=HALF_MAX);
}
const REFLECTION_FRESH_VALID:u32=0x8000u;
fn freshPack(r:vec3f,hit:f32)->vec4u{return texelWords(r,texelHalf(hit)|REFLECTION_FRESH_VALID);}
fn freshValid(t:vec2u)->bool{return ((t.y>>16u)&REFLECTION_FRESH_VALID)!=0u;}
fn freshHit(t:vec2u)->f32{return texelDistanceOf((t.y>>16u)&0x7fffu);}
fn rayPack(d:vec3f,traced:u32)->u32{
 let e=vec2u(round(clamp(octEncode(d),vec2f(-1.0),vec2f(1.0))*4095.0+4096.0));
 return (traced&31u)|(e.x<<5u)|(e.y<<18u);
}
fn rayDirection(w:u32)->vec3f{
 return octDecode((vec2f(vec2u((w>>5u)&8191u,(w>>18u)&8191u))-4096.0)/4095.0);
}
fn historyPack(r:vec3f,depth:f32,moment:f32,count:f32)->vec4u{
 let w=texelWords(r,texelHalf(depth));
 return vec4u(w.xy,bitcast<u32>(moment),bitcast<u32>(count));
}
/** Whether a history texel holds one: a surface's depth, never zero; a fresh history counts no image
 *  yet, and holds. */
fn historyValid(t:vec4u)->bool{return (t.y>>16u)!=0u;}
fn historyDepth(t:vec4u)->f32{return unpack2x16float(t.y>>16u).x;}
fn historyMoment(t:vec4u)->f32{return bitcast<f32>(t.z);}
fn historyCount(t:vec4u)->f32{return bitcast<f32>(t.w);}
fn reflectionLinearDepth(clip:vec4f)->f32{return select(clip.z,clip.w,slabPerspective(reflectionView.slab));}
fn surfaceLinearDepth(P:vec3f)->f32{return reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));}
fn reflectionDepthPixel(depth:f32)->f32{
 return select(reflectionView.slab.z,depth*reflectionView.slab.x,slabPerspective(reflectionView.slab));
}
fn reflectionSurfaceSpan(depth:f32,N:vec3f,V:vec3f)->vec2f{
 let c=max(dot(N,V),REFLECTION_GRAZING);
 return vec2f(reflectionDepthPixel(depth),1.0+sqrt(1.0-c*c)/c);
}
fn reflectionSameSurface(spanOf:vec2f,depth:f32,N:vec3f,other:f32,otherN:vec3f,pixels:f32)->f32{
 let span=max(pixels,1.0)*spanOf.x*spanOf.y;
 let near=1.0-smoothstep(span,2.0*span,abs(other-depth));
 return near*smoothstep(REFLECTION_CREASE_FAR,REFLECTION_CREASE_NEAR,dot(N,otherN));
}
fn reflectionToneScale()->f32{return view.lightParams.w/REFLECTION_DENOISER_RANGE;}
fn reflectionDenoised(c:vec3f)->vec3f{return c/(1.0+luminance(c)*reflectionToneScale());}
fn reflectionLinear(d:vec3f)->vec3f{return d/max(1.0-luminance(d)*reflectionToneScale(),REFLECTION_EPSILON);}`,
)
