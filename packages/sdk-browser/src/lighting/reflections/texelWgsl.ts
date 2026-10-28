import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HALF_MAX } from '../../../../math/src/wgsl/constants.ts'
import { lowHalf } from '../../../../math/src/wgsl/integer.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import {
  REFLECTION_GROUP,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from './viewLayout.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'

/**
 * THE TEXELS OF THE REFLECTIONS' TEXTURES (`grids.ts`), two words each. A texel holds the radiance of the lobe a pixel traces — its top layer's,
 * the clear coat's where it carries one, the base's elsewhere, one lobe a pixel, the sharpest it
 * shows — as three halves, `x` and the low half of `y`; the high
 * half of `y` differs by kind:
 *
 * - a FRESH texel, the trace's (`freshPack`) and the resolve's: the hit's distance as a half (bits
 *   0–14, held at `REFLECTION_DISTANCE_MAX`; a ray that met nothing is told at the longest ray) under a valid bit (15, the half's sign, a
 *   distance never negative), zero where the pixel casts or resolves nothing; a traced texel's ray
 *   beside it, in the layers of `REFLECTION_RAY_FORMAT`: the depth of the block's pixel the ray generation picked and the ray's direction and its cone angle
 *   (`surfaceRays`, `surfacesWgsl.ts`);
 * - a HISTORY texel, four words (`REFLECTION_HISTORY_FORMAT`), the temporal accumulation's
 *   (`historyPack`): the radiance's two words, the high half of `y` its surface's linear depth as a
 *   half — within 0.05 % of itself, under the history's distance threshold
 *   (`REFLECTION_HISTORY_DISTANCE`), zero where none, as the clear writes it: it carries the surface
 *   it was resolved on into the next image, whose depth no longer holds it —, `z` the second moment of
 *   its luminance in the denoiser's space (`historyMoment`), `w` how many images it averages, not
 *   rounded (`historyCount`, the history's images at most), each an `f32`'s bits.
 *
 * THE DENOISER'S SPACE: every mean of radiance — the resolve's, the accumulation's, the last pass's — is
 * taken on `reflectionDenoised` radiance, c / (1 + L(c)·e / the tonemap range), L the
 * luminance and e the image's pre-exposure, and turned back by `reflectionLinear`: under the range a radiance is itself, past it it weighs as the
 * range, so one sample of a headlight in a lobe's tail is a bright sample, not a thousandfold one that
 * lights a block.
 */
export const REFLECTION_TEXEL_WGSL = wgslBlock(
  'REFLECTION_TEXEL_WGSL',
  [
    HALF_MAX,
    lowHalf,
    luminance,
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_LINEAR_DEPTH_WGSL,
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
const REFLECTION_FRESH_VALID:u32=0x8000u;
fn freshPack(r:vec3f,hit:f32)->vec4u{return texelWords(r,texelHalf(min(hit,REFLECTION_DISTANCE_MAX))|REFLECTION_FRESH_VALID);}
fn freshValid(t:vec2u)->bool{return ((t.y>>16u)&REFLECTION_FRESH_VALID)!=0u;}
fn freshHit(t:vec2u)->f32{return texelHalfOf((t.y>>16u)&0x7fffu);}
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
fn reflectionToneScale()->f32{return select(0.0,view.preExposure.x/reflectionView.denoise.w,reflectionView.denoise.w>0.0);}
fn reflectionDenoised(c:vec3f)->vec3f{return c/(1.0+luminance(c)*reflectionToneScale());}
fn reflectionLinear(d:vec3f)->vec3f{return d/max(1.0-luminance(d)*reflectionToneScale(),REFLECTION_EPSILON);}
/** The images a history holds at most, \`frames\` for a lobe of roughness \`rough\`: the setting's, lerped down to two as the roughness
 *  falls under \`REFLECTION_MIRROR_ROUGHNESS\`, a mirror's noise left to the temporal anti-aliasing. */
fn reflectionMaxFrames(frames:f32,rough:f32)->f32{return mix(2.0,frames,saturate(rough/REFLECTION_MIRROR_ROUGHNESS));}`,
)
