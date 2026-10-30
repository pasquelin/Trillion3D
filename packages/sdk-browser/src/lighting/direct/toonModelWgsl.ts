import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { hsvToRgb, rgbToHsv } from '../../../../math/src/wgsl/color.ts'
import { SHADOW_TERMS_WGSL } from './shadowTermsWgsl.ts'
import {
  GGX_MAX_SIZE,
  GGX_MAX_VIEW_COSINES,
  GGX_MAX_VIEW_STEP,
} from '../../../../sdk-core/src/lighting/ggxMaxSpec.ts'
import {
  TOON_PARAM,
  TOON_PROFILE_ROWS,
} from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LAMP_LOBE_WGSL } from './lampLobeWgsl.ts'
import { RECT_SURFACE_LIGHT_WGSL } from './rectLightWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from './shadingModelState.ts'

/** The roughness the toon specular is held above: the perceptual roughness under which its lobe is a point. */
const TOON_MIN_ROUGHNESS = 0.02

/** The toon profile's reads from the toon buffer: a row's ramps and parameters, and a baked pattern bilinearly. */
const TOON_PROFILE_WGSL = wgslBlock(
  'TOON_PROFILE_WGSL',
  [SHADING_MODEL_STATE_WGSL],
  `
fn toonAtDiffuse()->u32{return 0u;}
fn toonAtSpecular()->u32{return 2u*toonSize();}
fn toonAtParams()->u32{return 5u*toonSize();}
fn toonAtShadow()->u32{return 4u*toonSize();}
fn toonAtIndirect()->u32{return 4u*toonSize()+toonSize()/2u;}
fn toonParam(row:u32,k:u32)->f32{return bitcast<f32>(toonRowWord(row,toonAtParams()+k));}
/** The ramp texel i of the ramp that starts at word base: red and green in the first word, blue in the second. */
fn toonTexel(row:u32,base:u32,i:u32)->vec3f{
 return vec3f(unpack2x16float(toonRowWord(row,base+i*2u)),unpack2x16float(toonRowWord(row,base+i*2u+1u)).x);
}
/** A ramp read at x as a texture of its texels is by a bilinear filter that clamps at the edge. */
fn toonRamp(row:u32,base:u32,x:f32)->vec3f{
 let last=toonSize()-1u;
 let p=clamp(x*f32(toonSize())-0.5,0.0,f32(last));
 let i=u32(floor(p));
 return mix(toonTexel(row,base,i),toonTexel(row,base,min(i+1u,last)),p-floor(p));
}
/** The texel i of the one-channel ramp that starts at word base (half floats, two a word). */
fn toonScalarTexel(row:u32,base:u32,i:u32)->f32{
 return unpack2x16float(toonRowWord(row,base+(i>>1u)))[i&1u];
}
/** A one-channel ramp read at x as a texture of its texels is by a bilinear filter that clamps at the edge. */
fn toonScalarRamp(row:u32,base:u32,x:f32)->f32{
 let last=toonSize()-1u;
 let p=clamp(x*f32(toonSize())-0.5,0.0,f32(last));
 let i=u32(floor(p));
 return mix(toonScalarTexel(row,base,i),toonScalarTexel(row,base,min(i+1u,last)),p-floor(p));
}
/** The texel (x, y) of the baked pattern kind (0 the offsets, 1 the hatching) of slot slot, as four channels. */
fn toonPatternTexel(slot:u32,kind:u32,x:u32,y:u32)->vec4f{
 let n=toonSize();
 let word=toonPatternWord(slot*2u*n*n+kind*n*n+y*n+x);
 if(kind==0u){return vec4f(unpack2x16unorm(word),0.0,0.0);}
 return unpack4x8unorm(word);
}
/** A baked pattern read bilinearly at the texel coordinate c (the centre of a texel at half a unit), clamped at the edge. */
fn toonPattern(slot:u32,kind:u32,c:vec2f)->vec4f{
 let last=toonSize()-1u;
 let p=clamp(c-0.5,vec2f(0.0),vec2f(f32(last)));
 let f=floor(p);let t=p-f;
 let x0=u32(f.x);let y0=u32(f.y);
 let x1=min(x0+1u,last);let y1=min(y0+1u,last);
 return mix(mix(toonPatternTexel(slot,kind,x0,y0),toonPatternTexel(slot,kind,x1,y0),t.x),mix(toonPatternTexel(slot,kind,x0,y1),toonPatternTexel(slot,kind,x1,y1),t.x),t.y);
}
/** The coordinate in texel units of the pixel's pattern coordinates uv, the fraction of their product by size, over the bake's texels inside their ring. */
fn toonPatternCoord(uv:vec2f,size:f32)->vec2f{return 1.0+fract(uv*size)*f32(toonSize()-2u);}
`,
)

/**
 * The indirect light of a toon pixel.
 * - The diffuse colour of the pixel whose plain one is `d` (a colour and a metalness): the colour times the profile's scale.
 * - The specular light `light` (the reflections, weighed): times the profile's scale and, where the setting is on (`toonQuantize`) and the profile's repetition above 0, quantised —
 *   the logarithm of the light, its value (the largest channel, in hue, saturation and value) repeated that many times, the fraction of it read in the specular indirect ramp, the whole
 *   spread back over the range.
 */
export const TOON_INDIRECT_WGSL = wgslBlock(
  'TOON_INDIRECT_WGSL',
  [TOON_PROFILE_WGSL, hsvToRgb, rgbToHsv],
  `
fn toonIndirectDiffuse(d:vec4f)->vec4f{
 return vec4f(d.rgb*toonParam(min(modelProfile,${TOON_PROFILE_ROWS - 1}u),${TOON_PARAM.diffuseIndirectScale}u),d.w);
}
fn toonIndirectSpecular(light:vec3f)->vec3f{
 let row=min(modelProfile,${TOON_PROFILE_ROWS - 1}u);
 let scaled=light*toonParam(row,${TOON_PARAM.specularIndirectScale}u);
 let repetition=toonParam(row,${TOON_PARAM.specularIndirectRampRepetition}u);
 if(!toonQuantize||repetition<=0.0){return scaled;}
 let hsv=rgbToHsv(log(max(scaled,vec3f(0.001))));
 let value=hsv.z*repetition;
 let level=fract(value);
 let ramped=value-level+toonScalarRamp(row,toonAtIndirect(),level);
 return exp(hsvToRgb(vec3f(hsv.xy,ramped/repetition)));
}`,
)

/** The peak of the specular lobe the toon specular is divided by, read from the table, at the roughness
 *  `rough`, the anisotropy `aniso` and the view cosine `noV`. */
const TOON_PEAK_WGSL = wgslBlock(
  'TOON_PEAK_WGSL',
  [PI],
  `
fn toonPeakTexel(x:u32,y:u32)->vec4f{
 let w=toonPeakWord(y*${GGX_MAX_SIZE}u+x);
 return vec4f(unpack2x16unorm(w.x),unpack2x16unorm(w.y));
}
fn toonPeak(rough:f32,aniso:f32,noV:f32)->f32{
 let p=vec2f(saturate(rough),saturate(abs(aniso)))*${GGX_MAX_SIZE - 1}.0;
 let f=floor(p);let t=p-f;
 let x0=u32(f.x);let y0=u32(f.y);
 let x1=min(x0+1u,${GGX_MAX_SIZE - 1}u);let y1=min(y0+1u,${GGX_MAX_SIZE - 1}u);
 let along=mix(mix(toonPeakTexel(x0,y0),toonPeakTexel(x1,y0),t.x),mix(toonPeakTexel(x0,y1),toonPeakTexel(x1,y1),t.x),t.y);
 let blend=1.0-saturate(abs(noV-vec4f(${GGX_MAX_VIEW_COSINES.map(wgslF32).join(',')}))/${wgslF32(GGX_MAX_VIEW_STEP)});
 return dot(along,blend)*PI;
}`,
)

/**
 * THE TOON CLOSURE of a light on a pixel of the toon model: its diffuse and specular, before the light's colour and its shares, from the
 * pixel's profile (`modelProfile`, its row of the light buffer) and its pattern coordinates (`modelToonUv`).
 * - The shadow: the light's transmittance `transmittance`, drawn as the profile's hatching where it wears an image — the hatching image's four
 *   channels blended along the distribution ramp read at the transmittance, faded to white by the strength.
 * - The diffuse: the cosine of the normal with the light, remapped from [-1, 1] to [0, 1] and, where the profile says so, times the transmittance,
 *   plus the diffuse ramp's offset (the baked image, repeating, of strength and size), read in the diffuse ramp, times the diffuse colour, over π,
 *   times the transmittance unless it is in the cosine, times the light's `energy` (its intensity through its falloff). Where the
 *   toon diffuse is unified (`toonUnified`), the ramp is left to the pass after the lights (`toonApplyDiffuse`), which applies it once to the sum.
 * - The specular: the lobe's value at the half vector, divided by its peak (`toonPeak`), plus the specular ramp's offset, read in the specular ramp,
 *   times the specular colour, the surface shadow, the cosine `cosine` and the energy.
 * `weight` and `shadowNoL` are what the unified diffuse accumulates: the light's weight (the transmittance times the energy) and the remapped cosine.
 */
const TOON_CLOSURE_WGSL = wgslBlock(
  'TOON_CLOSURE_WGSL',
  [TOON_PROFILE_WGSL, STANDARD_LIGHTING_WGSL, SHADOW_TERMS_WGSL],
  `
struct ToonSample{diffuse:vec3f,specular:vec3f,weight:f32,shadowNoL:f32,}
/** A light's toon light for the pixel, times the light's colour color and its shares share (the diffuse's in x, the specular's in y): the
 *  whole of it, or with the toon diffuse unified (toonUnified) the specular alone, the diffuse light added unramped to the pixel's sum with its weight, the luminance of
 *  the light's colour (the diffuse share's) times the closure's, and its weighted cosine (toonApplyDiffuse). */
fn toonLightOut(t:ToonSample,share:vec2f,color:vec3f)->vec3f{
 if(toonUnified){
  toonDiffuse+=t.diffuse*share.x*color;
  let weight=t.weight*luminance(color);
  toonWeight+=weight;
  toonWeightedNoL+=weight*t.shadowNoL;
  return t.specular*share.y*color;
 }
 return (t.diffuse*share.x+t.specular*share.y)*color;
}
/** The profile row of the pixel and the pattern slot its images take (−1: none). */
fn toonRowOf()->u32{return min(modelProfile,${TOON_PROFILE_ROWS - 1}u);}
fn toonSlotOf(row:u32)->i32{return i32(toonRowWord(row,toonAtParams()+${TOON_PARAM.patternSlot}u))-1;}
fn toonHatching(row:u32,slot:i32,transmittance:f32)->f32{
 let strength=toonParam(row,${TOON_PARAM.shadowHatchStrength}u);
 if(strength<=0.0||slot<0){return transmittance;}
 let hatch=toonPattern(u32(slot),1u,toonPatternCoord(modelToonUv,toonParam(row,${TOON_PARAM.shadowHatchSize}u)));
 let d=toonScalarRamp(row,toonAtShadow(),transmittance);
 var shadow=0.0;
 if(d<=0.25){shadow=mix(hatch.a,hatch.b,saturate(d/0.25));}
 else if(d<=0.5){shadow=mix(hatch.b,hatch.g,saturate((d-0.25)/0.25));}
 else if(d<=0.75){shadow=mix(hatch.g,hatch.r,saturate((d-0.5)/0.25));}
 else if(d<=1.0){shadow=mix(hatch.r,1.0,saturate((d-0.75)/0.25));}
 return mix(1.0,shadow,strength);
}
/** The offset the profile's image gives a ramp's input: channel 0 the diffuse's, 1 the specular's. */
fn toonDither(row:u32,slot:i32,channel:u32)->f32{
 let strength=toonParam(row,select(${TOON_PARAM.diffuseOffsetStrength}u,${TOON_PARAM.specularOffsetStrength}u,channel==1u));
 if(strength<=0.0||slot<0){return 0.0;}
 let size=toonParam(row,select(${TOON_PARAM.diffuseOffsetSize}u,${TOON_PARAM.specularOffsetSize}u,channel==1u));
 let value=toonPattern(u32(slot),0u,toonPatternCoord(modelToonUv,size));
 return strength*(select(value.x,value.y,channel==1u)*2.0-1.0);
}
/** The closure of a light on the surface s: spec the lobe's value over its peak, NoL the cosine of the normal with the light (signed), cosine
 *  the specular's (the lamp's, held above 0), energy the light's intensity through its falloff, surfaceShadow and transmittance its shadow terms. */
fn toonShade(s:LobeSurface,spec:f32,NoL:f32,cosine:f32,energy:f32,surfaceShadow:f32,transmittance:f32)->ToonSample{
 let row=toonRowOf();
 let slot=toonSlotOf(row);
 let shadow=toonHatching(row,slot,transmittance);
 var rampNoL=NoL*0.5+0.5;
 let includes=toonParam(row,${TOON_PARAM.rampIncludesShadow}u)>0.5;
 if(includes){rampNoL=rampNoL*shadow;}
 var ramp=vec3f(1.0);
 if(!toonUnified){ramp=toonRamp(row,toonAtDiffuse(),saturate(rampNoL+toonDither(row,slot,0u)));}
 var out:ToonSample;
 out.diffuse=select(shadow,1.0,includes)*energy*s.diffuse*ramp;
 out.weight=shadow*energy;
 out.shadowNoL=rampNoL;
 let rampSpec=toonRamp(row,toonAtSpecular(),saturate(spec+toonDither(row,slot,1u)));
 out.specular=surfaceShadow*cosine*energy*s.f0*rampSpec;
 return out;
}
`,
)

/**
 * A LAMP'S TOON LIGHT on the surface `s` of roughness `rough` (`toonLampLight`): its diffuse (column 0) and specular (column 1), before the
 * light's colour and shares. The lobe is the isotropic GGX distribution at the half vector of the lamp's look (a sphere's moved toward the normal),
 * the anisotropic one of the pixel's lobes where it has them (`skewedDistribution`), both at the roughness held above `TOON_MIN_ROUGHNESS`, as the peak is.
 */
export const TOON_LAMP_WGSL = wgslBlock(
  'TOON_LAMP_WGSL',
  [TOON_CLOSURE_WGSL, TOON_PEAK_WGSL, LAMP_LOBE_WGSL],
  `
fn toonLampLight(s:LobeSurface,rough:f32,N:vec3f,V:vec3f,light:DirectLight,P:vec3f,lamp:Lamp,energy:f32,terms:ShadowTerms)->ToonSample{
 var look=Look(lamp.toward,0.0,0.0,1.0);
 if(lamp.capsule){look=lampLook(light,P,N,V,lamp);}
 let safe=max(rough,${wgslF32(TOON_MIN_ROUGHNESS)});
 let a2=safe*safe*safe*safe;
 var lobe=0.0;
 var skew=0.0;
 if(hasSkew()){
  lobe=skewedDistribution(N,normalize(look.toward+V),safe*safe);
  skew=skewedAnisotropy();
 }else{
  let h=lampHalf(s,N,V,look);
  lobe=ggxDistribution(a2,h.x,max(1.0-h.x*h.x,0.0));
 }
 let spec=lobe*toonPeak(safe,skew,s.NdotV);
 return toonShade(s,spec,lamp.side,lamp.cosine,energy,terms.surface,terms.transmission);
}`,
)

/**
 * A RECTANGLE'S TOON LIGHT (`toonRectLight`): the cosine and the energy those of the rectangle's mean direction `centre` and its form factor, the
 * lobe's value the fitted lobe's integral over the rectangle (`rectLtc`), averaged over its channels, in the place of the distribution over its peak.
 */
export const TOON_RECT_WGSL = wgslBlock(
  'TOON_RECT_WGSL',
  [TOON_CLOSURE_WGSL, RECT_SURFACE_LIGHT_WGSL],
  `
fn toonRectLight(light:DirectLight,r:RectView,s:LobeSurface,N:vec3f,V:vec3f,rough:f32,centre:vec3f,terms:ShadowTerms)->ToonSample{
 let safe=max(rough,${wgslF32(TOON_MIN_ROUGHNESS)});
 let spec=dot(rectLtc(r,rectFrameOf(N,V,safe),s.f0),vec3f(1.0/3.0));
 let NoL=dot(N,centre);
 let energy=lightStrength(light)*rectWindowed(r);
 return toonShade(s,spec,NoL,saturate(NoL),energy,terms.surface,terms.transmission);
}`,
)

/**
 * THE TOON DIFFUSE APPLIED ONCE (`toonApplyDiffuse`), after the lights, where the profile's ramp is applied to the sum of their diffuse light
 * (`toonUnified`), which each light's draw added to the toon data: the cosine the lights averaged to — the sum of the weights times their remapped
 * cosines, `weights.y`, over the sum of the weights, `weights.x` — plus the offset, read in the diffuse ramp, times the sum `diffuse`.
 */
export const TOON_APPLY_WGSL = wgslBlock(
  'TOON_APPLY_WGSL',
  [TOON_CLOSURE_WGSL],
  `
fn toonApplyDiffuse(diffuse:vec3f,weights:vec2f)->vec3f{
 let row=toonRowOf();
 let slot=toonSlotOf(row);
 let NoL=weights.y/max(0.0001,weights.x);
 return diffuse*toonRamp(row,toonAtDiffuse(),saturate(NoL+toonDither(row,slot,0u)));
}`,
)
