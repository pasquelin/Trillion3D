import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { PI } from '../../../math/src/wgsl/constants.ts'
import { fastAcos, sinFromCosUnclamped } from '../../../math/src/wgsl/geometry.ts'

/** The bits of a hair BSDF's components: reflection (R), transmission through the fibre (TT), the internal
 *  reflection (TRT), the local and the global scattering of the dual scattering model, the multiple scattering
 *  that joins them to the rest, and the other model of the transmission. */
export const HAIR_COMPONENT = {
  r: 0x1,
  tt: 0x2,
  trt: 0x4,
  localScattering: 0x8,
  globalScattering: 0x10,
  multiScatter: 0x20,
  ttModel: 0x40,
} as const

/** The bits of the flags of a transmittance (`HairTransmittanceData.flags`). */
export const HAIR_TRANSMITTANCE_FLAG = {
  legacyAbsorption: 0x1,
  separableR: 0x2,
  backlit: 0x4,
  clampBsdf: 0x8,
} as const

const C = HAIR_COMPONENT
const F = HAIR_TRANSMITTANCE_FLAG

/**
 * THE HAIR FIBRE'S BSDF, the one the engine lights strands by: an approximation of the Marschner model with
 * its three lobes (R, TT, TRT, each a Gaussian along the fibre by the longitudinal angle and a fit across it),
 * the dual scattering that carries the light through the hair around (`HairTransmittanceData`: the global
 * scattering that multiplies, the local scattering that adds, the visibility of the opaque surfaces) and a
 * Kajiya-Kay diffuse in place of the further bounces. `n` is the unit direction along the fibre toward its
 * root, `v` and `l` the unit directions to the eye and to the light; the strand's colour is its base colour, its
 * `specular`, `metallic` (the share of the diffuse) and `backlit` the material's; `area` widens the lobes for
 * a light that has a source of some size. The result is never below 0.
 */
export const HAIR_BSDF_WGSL = wgslBlock(
  'HAIR_BSDF_WGSL',
  [PI, fastAcos, sinFromCosUnclamped],
  `struct HairTransmittanceData{flags:u32,opaqueVisibility:f32,localScattering:vec3f,globalScattering:vec3f,components:u32}
fn hairTransmittanceInit(multiScatter:bool,separable:bool)->HairTransmittanceData{
 var o:HairTransmittanceData;
 o.flags=${F.legacyAbsorption}u|select(0u,${F.separableR}u,separable)|${F.clampBsdf}u;
 o.opaqueVisibility=1.0;
 o.localScattering=vec3f(0.0);
 o.globalScattering=vec3f(1.0);
 o.components=${C.r | C.tt | C.trt}u|select(0u,${C.multiScatter}u,multiScatter);
 return o;
}
// The transmittance the strands are lit with: the legacy absorption off, the backlit share read.
fn hairStrandsTransmittanceInit(multiScatter:bool)->HairTransmittanceData{
 var o=hairTransmittanceInit(multiScatter,true);
 o.flags=(o.flags&~${F.legacyAbsorption}u)|${F.backlit}u;
 return o;
}
fn asinFast(x:f32)->f32{return 0.5*PI-fastAcos(x);}
fn hairG(B:f32,theta:f32,clampValue:bool)->f32{
 let denominator=select(B,max(B,0.01),clampValue);
 return exp(-0.5*theta*theta/(B*B))/(sqrt(2.0*PI)*denominator);
}
fn hairF(cosTheta:f32)->f32{
 let n=1.55;
 let f0=((1.0-n)/(1.0+n))*((1.0-n)/(1.0+n));
 let m=1.0-cosTheta;
 return f0+(1.0-f0)*m*m*m*m*m;
}
// A colour as the absorption that makes a fibre of it, and back.
fn hairColorToAbsorption(c:vec3f)->vec3f{
 let b=0.3;
 let b2=b*b;
 let d=5.969-0.215*b+2.532*b2-10.73*b2*b+5.574*b2*b2+0.245*b2*b2*b;
 let l=log(c)/d;
 return l*l;
}
fn kajiyaKayDiffuse(base:vec3f,metallic:f32,l:vec3f,v:vec3f,n:vec3f,shadow:f32)->vec3f{
 let kajiya=1.0-abs(dot(n,l));
 let fake=normalize(v-n*dot(v,n));
 let wrap=1.0;
 let nol=saturate((dot(fake,l)+wrap)/((1.0+wrap)*(1.0+wrap)));
 let diffuse=(1.0/PI)*mix(nol,kajiya,0.33)*metallic;
 let luma=dot(base,vec3f(0.2126,0.7152,0.0722));
 let overLuma=abs(base/max(luma,0.0001));
 let tint=select(vec3f(1.0),pow(overLuma,vec3f(1.0-shadow)),shadow<1.0);
 return sqrt(abs(base))*diffuse*tint;
}
fn hairShading(base:vec3f,roughness:f32,specular:f32,metallic:f32,backlitMaterial:f32,l:vec3f,v:vec3f,n:vec3f,shadow:f32,td:HairTransmittanceData,inBacklit:f32,area:f32)->vec3f{
 let clamped=clamp(roughness,1.0/255.0,1.0);
 let backlit=min(inBacklit,select(1.0,backlitMaterial,(td.flags&${F.backlit}u)!=0u));
 let vol=dot(v,l);
 let sinL=clamp(dot(n,l),-1.0,1.0);
 let sinV=clamp(dot(n,v),-1.0,1.0);
 let cosD=cos(0.5*abs(asinFast(sinV)-asinFast(sinL)));
 let lp=l-sinL*n;
 let vp=v-sinV*n;
 let cosPhi=dot(lp,vp)*inverseSqrt(dot(lp,lp)*dot(vp,vp)+1e-4);
 let cosHalfPhi=sqrt(saturate(0.5+0.5*cosPhi));
 let n_prime=1.19/cosD+0.36*cosD;
 let tilt=0.035;
 let alphaR=-tilt*2.0;
 let alphaTT=tilt;
 let alphaTRT=tilt*4.0;
 let bR=area+clamped*clamped;
 let bTT=area+clamped*clamped/2.0;
 let bTRT=area+clamped*clamped*2.0;
 let clampValue=(td.flags&${F.clampBsdf}u)!=0u;
 var s=vec3f(0.0);
 if((td.components&${C.r}u)!=0u){
  let sa=sin(alphaR);
  let ca=cos(alphaR);
  let shiftR=2.0*sa*(ca*cosHalfPhi*sinFromCosUnclamped(sinV)+sa*sinV);
  let bScale=select(1.0,sqrt(2.0)*cosHalfPhi,(td.flags&${F.separableR}u)!=0u);
  let mp=hairG(bR*bScale,sinL+sinV-shiftR,clampValue);
  let np=0.25*cosHalfPhi;
  let fp=hairF(sqrt(saturate(0.5+0.5*vol)));
  s+=vec3f(mp*np*fp*(specular*2.0)*mix(1.0,backlit,saturate(-vol)));
 }
 if((td.components&${C.tt}u)!=0u){
  let mp=hairG(bTT,sinL+sinV-alphaTT,clampValue);
  let a=1.0/n_prime;
  let h=cosHalfPhi*(1.0+a*(0.6-0.8*cosPhi));
  let f=hairF(cosD*sqrt(saturate(1.0-h*h)));
  let fp=(1.0-f)*(1.0-f);
  var tp=vec3f(0.0);
  if((td.flags&${F.legacyAbsorption}u)!=0u){
   tp=pow(abs(base),vec3f(0.5*sqrt(1.0-(h*a)*(h*a))/cosD));
  }else{
   let absorption=hairColorToAbsorption(base);
   tp=exp(-absorption*2.0*abs(1.0-(h*a)*(h*a)/cosD));
  }
  let np=exp(-3.65*cosPhi-3.98);
  s+=mp*np*fp*tp*backlit;
 }
 if((td.components&${C.trt}u)!=0u){
  let mp=hairG(bTRT,sinL+sinV-alphaTRT,clampValue);
  let f=hairF(cosD*0.5);
  let fp=(1.0-f)*(1.0-f)*f;
  let tp=pow(abs(base),vec3f(0.8/cosD));
  let np=exp(17.0*cosPhi-16.78);
  s+=mp*np*fp*tp;
 }
 if((td.components&${C.multiScatter}u)!=0u){
  s=td.globalScattering*(s+td.localScattering)*td.opaqueVisibility;
  s+=kajiyaKayDiffuse(base,metallic,l,v,n,shadow);
 }
 return max(s,vec3f(0.0));
}`,
)

/** The table of the fibre's average scattering, declared at (`group`, `binding`), and the Gaussians of the lobes. */
const lutReadText = (
  group: number,
  binding: number,
) => `@group(${group}) @binding(${binding}) var hairLut:texture_3d<f32>;
@group(${group}) @binding(${binding + 1}) var hairLutSampler:sampler;
struct HairAverage{front:vec3f,back:vec3f}
fn sampleHairLut(absorption:vec3f,roughness:f32,sinAngle:f32)->HairAverage{
 let remapped=sqrt(absorption);
 let u=saturate(abs(sinAngle));
 let w=saturate(roughness);
 let r=textureSampleLevel(hairLut,hairLutSampler,vec3f(u,w,saturate(remapped.x)),0.0).xy;
 let g=textureSampleLevel(hairLut,hairLutSampler,vec3f(u,w,saturate(remapped.y)),0.0).xy;
 let b=textureSampleLevel(hairLut,hairLutSampler,vec3f(u,w,saturate(remapped.z)),0.0).xy;
 return HairAverage(vec3f(r.x,g.x,b.x),vec3f(r.y,g.y,b.y));
}
fn hairG2(variance:f32,theta:f32)->f32{return exp(-0.5*theta*theta/variance);}
fn hairGaussians(variance:vec3f,theta:vec3f)->vec3f{return vec3f(hairG2(variance.x,theta.x),hairG2(variance.y,theta.y),hairG2(variance.z,theta.z));}`

/** The dual scattering: the global and the local terms that join the fibre's BSDF to the hair about it. */
const DUAL_SCATTERING_TEXT = `fn dualScattering(mask:vec2f,average:HairAverage,roughnessIn:f32,v:vec3f,l:vec3f,t:vec3f,components:u32)->HairTransmittanceData{
 let sinL=clamp(dot(t,l),-1.0,1.0);
 let sinV=clamp(dot(t,v),-1.0,1.0);
 let maxAverage=0.99;
 let af=min(vec3f(maxAverage),average.front);
 let af2=af*af;
 let ab=min(vec3f(maxAverage),average.back);
 let ab2=ab*ab;
 let oneMinusAf2=vec3f(1.0)-af2;
 let a1=ab*af2/oneMinusAf2;
 let a3=ab*ab2*af2/(oneMinusAf2*oneMinusAf2*oneMinusAf2);
 let abTotal=a1+a3;
 let roughness=clamp(roughnessIn,0.18,0.6);
 let betaR=roughness*roughness;
 let betaTT=roughness*roughness/4.0;
 let betaTRT=roughness*roughness*4.0;
 let df=0.7;
 let db=0.7;
 let hairCount=max(0.0,mask.x-1.0);
 let afWeights=af/(af.x+af.y+af.z);
 let betaF=dot(vec3f(betaR,betaTT,betaTRT),afWeights);
 let betaF2=betaF*betaF;
 let sigmaF2=vec3f(betaF2*max(1.0,hairCount));
 let thetaH=(asin(sinL)+asin(sinV))*0.5;
 let sf=hairGaussians(sigmaF2,vec3f(thetaH))/PI;
 let tf=pow(average.front,vec3f(hairCount));
 let tiltF=dot(vec3f(-0.035*2.0,0.035,0.035*4.0),afWeights);
 let tiltB=tiltF;
 let deltaB=tiltB*(vec3f(1.0)-2.0*ab2/((vec3f(1.0)-af2)*(vec3f(1.0)-af2)))*tiltF*(2.0*(vec3f(1.0)-af2)*(vec3f(1.0)-af2)+4.0*af2*ab2)/((vec3f(1.0)-af2)*(vec3f(1.0)-af2)*(vec3f(1.0)-af2));
 let abWeights=ab/(ab.x+ab.y+ab.z);
 let betaB=dot(vec3f(betaR,betaTT,betaTRT),abWeights);
 let betaB2=betaB*betaB;
 let sigmaB=(1.0+db*af2)*(ab*sqrt(2.0*betaF2+betaB2)+ab*ab2*sqrt(2.0*betaF2+betaB2))/(ab+ab*ab2*(2.0*betaF+3.0*betaB));
 let sigmaB2=sigmaB*sigmaB;
 let sb=hairGaussians(sigmaF2+sigmaB2,vec3f(thetaH)-deltaB)/PI;
 let globalTerm=mix(vec3f(1.0),tf*sf*df,saturate(hairCount));
 let localTerm=2.0*abTotal*sb*db;
 var result=hairStrandsTransmittanceInit(false);
 result.components=components|${C.multiScatter}u;
 result.globalScattering=select(vec3f(1.0),globalTerm,(components&${C.globalScattering}u)!=0u);
 result.localScattering=select(vec3f(0.0),localTerm,(components&${C.localScattering}u)!=0u);
 result.flags=select(result.flags|${F.legacyAbsorption}u,result.flags&~${F.legacyAbsorption}u,(components&${C.ttModel}u)!=0u);
 result.opaqueVisibility=mask.y;
 return result;
}`

/** The transmittance toward a light and the fibre's albedo for the environment. */
const TRANSMITTANCE_TEXT = `// The transmittance of a point toward a light: the table read for its colour, roughness (\`roughnessOverride\`
// replaces it where above 0) and the light's angle along the fibre, then the dual scattering terms.
fn hairTransmittance(v:vec3f,l:vec3f,base:vec3f,roughness:f32,roughnessOverride:f32,t:vec3f,mask:vec2f,components:u32)->HairTransmittanceData{
 let r=select(roughness,roughnessOverride,roughnessOverride>0.0);
 return dualScattering(mask,sampleHairLut(base,r,dot(l,t)),r,v,l,t,components);
}
// The fibre's response to the light from the direction it is seen along, as the albedo that weighs a spherical
// integral of the environment: the BSDF for that imaginary direction with the dual scattering of a mask that holds
// no hair, times 2 pi, held to 1 so that no energy is added. \`base\` is held above 0 first.
fn evaluateEnvHair(baseIn:vec3f,roughness:f32,specular:f32,metallic:f32,v:vec3f,n:vec3f,components:u32)->vec3f{
 let base=max(vec3f(0.0001),baseIn);
 let l=normalize(v-n*dot(v,n));
 let td=hairTransmittance(v,l,base,roughness,0.0,n,vec2f(0.0,1.0),components);
 return min(vec3f(1.0),2.0*PI*hairShading(base,roughness,specular,metallic,1.0,l,v,n,1.0,td,0.0,0.2));
}`

/**
 * THE DUAL SCATTERING of the hair around a strand: from the average scattering the table gives (its front
 * and back attenuation for a colour, a roughness and the angle of the light along the fibre), the transmittance
 * mask's hair count and visibility, the terms that join the fibre's BSDF to the hair about it —
 * the global scattering (the light that crosses the hair between the light and the point, spread by the
 * lobes' variances) and the local scattering (the light that returns from the hair behind, shifted and
 * spread). `hairLut` (a 3D texture of the average scattering: front in x, back in y) and `hairLutSampler` are
 * declared at (`group`, `binding`) and the next binding. `mask` is `(hairCount, visibility)`. A hair count is
 * taken one less, so that the first strand of the hair counts for nothing.
 */
export const hairScatteringWgsl = (group: number, binding: number) =>
  wgslBlock(
    `HAIR_SCATTERING_WGSL(${group}, ${binding})`,
    [HAIR_BSDF_WGSL],
    `${lutReadText(group, binding)}\n${DUAL_SCATTERING_TEXT}\n${TRANSMITTANCE_TEXT}`,
  )
