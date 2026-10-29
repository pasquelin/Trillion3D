import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { Frame3, intoFrame, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { visibleGgxHalf } from '../../../../math/src/wgsl/sampling.ts'
import { SHADING_ENERGY_SIZE } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'
import { packedTableWgsl } from '../direct/packedTableWgsl.ts'
import { PT_FUZZ_WGSL } from './fuzzWgsl.ts'
import { PT_GLASS_WGSL } from './glassWgsl.ts'
import { PT_LOBE_WGSL } from './lobeWgsl.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'
import { PT_SURFACE_WGSL } from './surfaceWgsl.ts'

/** The directional albedo of a rough specular lobe, read at (N·V, roughness) from the table in the lights' buffer (`shadingEnergyPair`). */
export const PT_SHADING_ENERGY_WGSL = packedTableWgsl(
  'shadingEnergyTexel',
  'shadingEnergyPair',
  'energy',
  SHADING_ENERGY_SIZE,
  SHADING_ENERGY_SIZE,
)

/**
 * THE THIN GLASS OF THE PATH TRACER: a pane of no thickness (a glass whose walls have none), which bends nothing: a slab of two interfaces, its colour the law of the medium for a unit length,
 * lit by four lobes chosen by their colours (`ptLobeCdf`, the diffuse scatter first, then the fuzz, the reflection of the slab and its transmission).
 *
 * - `ptThinSlab(tint, cosV, eta, f0)` is the share of the light a slab reflects and transmits along a view, the repeated reflections inside it summed as a geometric series.
 * - `ptHanrahanKrueger(nov, nol, tr)` is the weight of the light scattered inside the slab, to either side, as the paper's equations 8, 11 and 12 give it.
 * - `ptPrepareThin(s, b)` fixes the slab for the prepared `b`: the roughness of the transmitted lobe (squeezed by the index), the energy of both specular lobes and the weight that restores what their
 *   single scattering misses, the share of the diffuse scatter, and the cumulative table and the chances of the four lobes.
 * - `ptSampleThin(s, b, e)` draws a lobe and a direction in it (a transmission leaves on the other side of the surface, `positionBias` of minus one, and is a `PT_SCATTER.refract`; the scatter is isotropic);
 *   `ptEvalThin(s, b, world, scale)` is the weight and the density of a direction given. Both count the density of every lobe, each against the others (`ptAddLobe`).
 */
export const PT_THIN_GLASS_WGSL = wgslBlock(
  'PT_THIN_GLASS_WGSL',
  [
    PI,
    Frame3,
    intoFrame,
    outOfFrame,
    visibleGgxHalf,
    PT_SHADING_ENERGY_WGSL,
    PT_LOBE_WGSL,
    PT_SURFACE_WGSL,
    PT_FUZZ_WGSL,
    PT_GLASS_WGSL,
    PT_MONTE_CARLO_WGSL,
  ],
  `struct PtSlab{reflected:vec3f,transmitted:vec3f,}
fn ptThinSlab(tint:vec3f,cosV:f32,eta:f32,f0:f32)->PtSlab{
 let f90=saturate(f0*50.0);
 let k=1.0-cosV;
 let r=mix(f0,f90,k*k*k*k*k);
 let a=pow(tint,vec3f(select(1.0/max(abs(cosV),1.0e-6),eta*inverseSqrt(eta*eta-1.0+cosV*cosV),eta>1.0)));
 var out=PtSlab(vec3f(r),a-r*a);
 if(r<1.0){
  let inv=vec3f(1.0)/(vec3f(1.0)-(r*a)*(r*a));
  out.reflected+=r*out.transmitted*out.transmitted*inv;
  out.transmitted*=inv-r*inv;
 }
 return out;
}
fn ptHanrahanKrueger(nov:f32,nol:f32,tr:vec3f)->vec3f{
 let sigma=-log(max(tr,vec3f(1.0e-5)));
 if(nov>0.0){
  if(nol>0.0){return (vec3f(1.0)-exp(-sigma*(1.0/nol+1.0/nov)))*nol/(nov+nol);}
  if(nol<0.0){
   if(abs(nov+nol)>1.0e-5){return (exp(-sigma/nov)-exp(sigma/nol))*(-nol)/(nov+nol);}
   return sigma*exp(-sigma/nov)/nov;
  }
 }
 return vec3f(0.0);
}
fn ptThinSpec(rough:f32,nov:f32,f0:f32,f90:f32)->vec2f{
 let e=shadingEnergyPair(rough,nov);
 let w=1.0+f0*((1.0-e.x)/max(e.x,1.0e-4));
 return vec2f(w*(e.x*f0+e.y*(f90-f0)),w);
}
fn ptPrepareThin(s:PtSurface,b:PtBsdf)->PtBsdf{
 var out=b;
 let rough=max(s.roughness,0.01);
 let roughT=max(rough*sqrt(max(1.0-min(s.ior,1.0/s.ior),0.0)),0.01);
 out.alphaT=roughT*roughT;
 out.eta=s.ior;
 let f0=ptGlassReflectance(s);
 let f90=saturate(f0*50.0);
 let nov=saturate(b.v.z);
 let r=ptThinSpec(rough,nov,f0,f90);
 let t=ptThinSpec(roughT,nov,1.0-f0,1.0-f90);
 let nudge=1.0/max(r.x+t.x,1.0e-6);
 let keep=b.fuzz.keep;
 out.diffuseWeight=keep*(1.0-keep*r.x*nudge);
 out.specRW=r.y*nudge;
 out.specTW=t.y*nudge;
 let fuzzAlbedo=b.fuzz.scale*s.fuzzColor;
 let weights=vec4f(out.diffuseWeight*(s.diffuse.x+s.diffuse.y+s.diffuse.z),fuzzAlbedo.x+fuzzAlbedo.y+fuzzAlbedo.z,3.0*keep*r.x*nudge,3.0*keep*t.x*nudge);
 let leftOrRight=ptMisBalance(weights.x+weights.y,weights.z+weights.w);
 let first=ptMisBalance(weights.x,weights.y);
 let second=ptMisBalance(weights.z,weights.w);
 out.thinCdf=vec3f(first*leftOrRight,leftOrRight,(leftOrRight+second)-leftOrRight*second);
 out.thinPdf=vec4f(out.thinCdf.x,out.thinCdf.y-out.thinCdf.x,out.thinCdf.z-out.thinCdf.y,1.0-out.thinCdf.z);
 return out;
}
fn ptSampleThin(s:PtSurface,b:PtBsdf,e:vec3f)->PtSample{
 var out:PtSample;
 out.roughness=1.0;
 var r=e;
 var l=vec3f(0.0,0.0,1.0);
 var h=vec3f(0.0,0.0,1.0);
 var scatterWeight=vec3f(0.0);
 var reflection=r.x<b.thinCdf.z;
 let scatter=r.x<b.thinCdf.x;
 let cloth=!scatter&&r.x<b.thinCdf.y;
 if(scatter){
  let z=1.0-2.0*r.y;
  let planar=sqrt(max(1.0-z*z,0.0));
  let phi=2.0*PI*ptRescale(r.x,0.0,b.thinCdf.x);
  l=vec3f(planar*cos(phi),planar*sin(phi),z);
  scatterWeight=ptHanrahanKrueger(b.v.z,l.z,s.tint);
  reflection=l.z>0.0;
  l.z=abs(l.z);
  h=normalize(l+b.v);
 }else if(cloth){
  r.x=ptRescale(r.x,b.thinCdf.x,b.thinCdf.y);
  l=ptFuzzSample(b.fuzz,r.xy);
  h=normalize(l+b.v);
 }else{
  r.x=select(ptRescale(r.x,b.thinCdf.z,1.0),ptRescale(r.x,b.thinCdf.y,b.thinCdf.z),reflection);
  let alpha=select(b.alphaT,b.alpha,reflection);
  h=visibleGgxHalf(r.xy,vec2f(alpha),b.v);
  l=reflect(-b.v,h);
  if(l.z<=0.0){return PtSample(vec3f(0.0),vec3f(0.0),0.0,1.0,1.0,PT_SCATTER_CAMERA);}
  out.roughness=select(sqrt(b.alphaT),s.roughness,reflection);
 }
 out.positionBias=select(-1.0,1.0,reflection);
 out.direction=outOfFrame(vec3f(l.xy,out.positionBias*l.z),b.frame);
 out.scatter=select(select(PT_SCATTER_REFRACT,PT_SCATTER_SPECULAR,reflection),PT_SCATTER_DIFFUSE,scatter);
 let ggx=ptGgxEval(l,b.v,h,select(b.alphaT,b.alpha,reflection));
 let clothResult=select(vec4f(0.0),ptFuzzEval(b.fuzz,l,s.fuzzColor),reflection);
 let scatterPdf=0.25/PI;
 var lobes=PtLobes(vec3f(0.0),0.0);
 let glassProb=select(b.thinPdf.w,b.thinPdf.z,reflection);
 if(scatter){
  lobes=ptAddLobe(lobes,b.diffuseWeight*s.diffuse*scatterWeight,scatterPdf,b.thinPdf.x);
  lobes.pdf+=b.thinPdf.y*clothResult.w+glassProb*ggx.y;
 }else if(cloth){
  lobes=ptAddLobe(lobes,clothResult.xyz*ptShadowTerminator(out.direction,s.normal,s.vertexNormal),clothResult.w,b.thinPdf.y);
  lobes.pdf+=b.thinPdf.x*scatterPdf+b.thinPdf.z*ggx.y;
 }else{
  let slab=ptThinSlab(s.tint,saturate(dot(b.v,h)),b.eta,ptGlassReflectance(s));
  let tint=select(slab.transmitted,slab.reflected,reflection);
  lobes=ptAddLobe(lobes,b.fuzz.keep*ggx.x*select(b.specTW,b.specRW,reflection)*tint,ggx.y,glassProb);
  lobes.pdf+=b.thinPdf.y*clothResult.w+b.thinPdf.x*scatterPdf;
 }
 out.weight=lobes.weight*s.selection;
 out.pdf=lobes.pdf;
 return out;
}
fn ptEvalThin(s:PtSurface,b:PtBsdf,world:vec3f,scale:vec2f)->PtEval{
 var l=intoFrame(b.frame,world);
 let scatterPdf=0.25/PI;
 var lobes=PtLobes(vec3f(0.0),0.0);
 lobes=ptAddLobe(lobes,scale.x*b.diffuseWeight*s.diffuse*ptHanrahanKrueger(b.v.z,l.z,s.tint),scatterPdf,b.thinPdf.x);
 let reflection=l.z>=0.0;
 l.z=abs(l.z);
 let h=normalize(l+b.v);
 let ggx=ptGgxEval(l,b.v,h,select(b.alphaT,b.alpha,reflection));
 let slab=ptThinSlab(s.tint,saturate(dot(b.v,h)),b.eta,ptGlassReflectance(s));
 let tint=select(slab.transmitted,slab.reflected,reflection);
 lobes=ptAddLobe(lobes,scale.y*b.fuzz.keep*ggx.x*select(b.specTW,b.specRW,reflection)*tint,ggx.y,select(b.thinPdf.w,b.thinPdf.z,reflection));
 if(reflection){
  let cloth=ptFuzzEval(b.fuzz,l,s.fuzzColor);
  lobes=ptAddLobe(lobes,scale.y*cloth.xyz*ptShadowTerminator(world,s.normal,s.vertexNormal),cloth.w,b.thinPdf.y);
 }
 return PtEval(lobes.weight*s.selection,lobes.pdf);
}`,
)
