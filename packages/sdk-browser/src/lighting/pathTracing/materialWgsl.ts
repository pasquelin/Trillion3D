import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { Frame3, frameAround, intoFrame, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { fresnelSchlick } from '../../../../math/src/wgsl/lighting.ts'
import { visibleGgxHalf } from '../../../../math/src/wgsl/sampling.ts'
import { PT_LOBE_WGSL } from './lobeWgsl.ts'
import { sheenFuzzRoughness } from '../direct/sheenLobeWgsl.ts'
import { PT_FUZZ_WGSL } from './fuzzWgsl.ts'
import { PT_GLASS_WGSL } from './glassWgsl.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'
import { PT_SCATTER_WGSL, PT_SURFACE_WGSL } from './surfaceWgsl.ts'
import { PT_SHADING_ENERGY_WGSL, PT_THIN_GLASS_WGSL } from './thinGlassWgsl.ts'

/**
 * THE PATH TRACER'S BSDF OVER A HIT (`PtSurface`, `surfaceWgsl.ts`): one slab of the reference's material model — a diffuse lobe and a GGX specular lobe under a cloth's fuzz (`fuzzWgsl.ts`) —, or a glass
 * (`glassWgsl.ts`) where the hit's pick made it one, with the three things the integrator asks of it.
 *
 * `ptPrepareBsdf(surface, v)` fixes the surface for a view direction `v` (pointing to the eye): the shading normal clipped in a view-dependent way so that the reflection
 * stays above the geometric normal (`ptAdjustNormal`), the frame about it, the view in it, the lobe's width (roughness squared, the roughness held over 0.01), the
 * specular lobe's grazing reflectance (`f0` times 50, held to 1: a surface of no reflectance has no specular), the energy the lobe keeps and the weight that restores
 * what its single scattering misses (the engine's table, `shadingEnergyPair`), the share of the diffuse light the specular lobe leaves (`1 - luminance(E)`), and the probability of
 * choosing each lobe among the diffuse, the specular and the fuzz (by the sum of the lobes' colours, `ptMisBalance`, one half each of the first two when both are black; the lobes under the fuzz keep what it leaves of the light, `PtFuzz.keep`).
 * `ptSampleMaterial(surface, bsdf, e)` chooses a lobe and a direction in it — the cosine lobe about the normal (or, for the light a two-sided leaf passes through, about the opposite normal, the ray then leaving by the other side of the surface), or a half vector drawn from the visible normals
 * (`visibleGgxHalf`) and the view reflected on it, which a below-the-horizon direction discards (a null sample), or the fuzz's —, and returns the weight (BSDF times cosine over the density) and
 * the density of the direction counting both lobes, each lobe weighed against the other (`ptAddLobe`).
 * `ptEvalMaterial(surface, bsdf, l, scale)` is the weight and the density of a direction `l` given: `scale.x` and `scale.y` multiply the diffuse and specular lobes (a light's shares).
 * The diffuse and the fuzz lobes are softened where the shading normal and the vertex normal disagree (`ptShadowTerminator`, the microfacet shadowing of the bump terminator problem); the transmitted light is not.
 * `ptMaterialAlbedo(surface)` is the estimate of the colour the surface sends back, which picks which hit of a transparent run is kept and what the denoiser's albedo holds.
 */
export const PT_MATERIAL_WGSL = wgslBlock(
  'PT_MATERIAL_WGSL',
  [
    PT_SCATTER_WGSL,
    PT_SURFACE_WGSL,
    PT_FUZZ_WGSL,
    PT_GLASS_WGSL,
    PT_THIN_GLASS_WGSL,
    sheenFuzzRoughness,
    PI,
    Frame3,
    frameAround,
    intoFrame,
    outOfFrame,
    luminance,
    fresnelSchlick,
    visibleGgxHalf,
    PT_LOBE_WGSL,
    PT_MONTE_CARLO_WGSL,
    PT_SHADING_ENERGY_WGSL,
  ],
  `fn ptAdjustNormal(n:vec3f,geo:vec3f,v:vec3f)->vec3f{
 let d=-v;
 let r=reflect(d,n);
 let k=dot(r,geo);
 if(k<0.0){return normalize(normalize(r-k*geo)-d);}
 return n;
}
fn ptPrepareBsdf(s:PtSurface,v:vec3f)->PtBsdf{
 var b:PtBsdf;
 b.frame=frameAround(ptAdjustNormal(s.normal,s.geoNormal,v));
 b.v=intoFrame(b.frame,v);
 let rough=max(s.roughness,0.01);
 b.alpha=rough*rough;
 b.fuzz=PtFuzz(vec2f(1.0,0.0),0.0,0.0,0.0,1.0);
 if(s.fuzz>0.0){b.fuzz=ptFuzzPrepare(b.v,sheenFuzzRoughness(s.roughness),s.fuzz);}
 if(s.thin){return ptPrepareThin(s,b);}
 if(s.glass){return ptPrepareGlass(s,b);}
 b.f0=s.f0;
 b.f90=saturate(dot(s.f0,vec3f(1.0/3.0))*50.0);
 let e=shadingEnergyPair(rough,saturate(b.v.z));
 let energy=s.f0*e.x+(vec3f(b.f90)-s.f0)*e.y;
 b.specWeight=(vec3f(1.0)+s.f0*((1.0-e.x)/e.x))*b.fuzz.keep;
 b.diffuseWeight=b.fuzz.keep*(1.0-luminance(energy));
 let diffuse=b.diffuseWeight*(s.diffuse+s.transmit);
 let transmitSum=s.transmit.x+s.transmit.y+s.transmit.z;
 b.transmitProb=select(0.0,ptMisBalance(transmitSum,s.diffuse.x+s.diffuse.y+s.diffuse.z),transmitSum>0.0);
 let fuzzAlbedo=b.fuzz.scale*s.fuzzColor;
 let diffuseSum=diffuse.x+diffuse.y+diffuse.z;
 let specSum=b.fuzz.keep*(energy.x+energy.y+energy.z);
 let fuzzSum=fuzzAlbedo.x+fuzzAlbedo.y+fuzzAlbedo.z;
 let diffuseOrSpec=ptMisBalance(diffuseSum,specSum);
 let slab=select(ptMisBalance(diffuseSum+specSum,fuzzSum),1.0,fuzzSum<=0.0);
 b.diffuseProb=diffuseOrSpec*slab;
 b.specProb=slab-b.diffuseProb;
 return b;
}
fn ptSpecularWeight(b:PtBsdf,h:vec3f,ggx:vec2f)->vec3f{
 return fresnelSchlick(b.f0,b.f90,saturate(dot(b.v,h)))*ggx.x*b.specWeight;
}
fn ptFuzzProb(b:PtBsdf)->f32{return 1.0-b.diffuseProb-b.specProb;}
fn ptSampleMaterial(s:PtSurface,b:PtBsdf,e:vec3f)->PtSample{
 if(s.thin){return ptSampleThin(s,b,e);}
 if(s.glass){return ptSampleGlass(s,b,e);}
 var out:PtSample;
 out.positionBias=1.0;
 out.roughness=1.0;
 var r=e;
 let diffuse=r.x<b.diffuseProb;
 let specular=!diffuse&&r.x<b.diffuseProb+b.specProb;
 let transmitProb=b.diffuseProb*b.transmitProb;
 let transmit=diffuse&&r.x<transmitProb;
 var l=vec3f(0.0);
 var h=vec3f(0.0,0.0,1.0);
 if(diffuse){
  r.x=select(ptRescale(r.x,transmitProb,b.diffuseProb),ptRescale(r.x,0.0,transmitProb),transmit);
  out.direction=ptSampleCosine(r.xy,select(s.normal,-s.normal,transmit)).xyz;
  out.positionBias=select(1.0,-1.0,transmit);
  l=intoFrame(b.frame,out.direction);
  h=normalize(l+b.v);
 }else if(specular){
  r.x=ptRescale(r.x,b.diffuseProb,b.diffuseProb+b.specProb);
  out.roughness=s.roughness;
  h=visibleGgxHalf(r.xy,vec2f(b.alpha),b.v);
  l=reflect(-b.v,h);
  if(l.z<=0.0){return PtSample(vec3f(0.0),vec3f(0.0),0.0,1.0,1.0,PT_SCATTER_CAMERA);}
  out.direction=outOfFrame(l,b.frame);
 }else{
  r.x=ptRescale(r.x,b.diffuseProb+b.specProb,1.0);
  l=ptFuzzSample(b.fuzz,r.xy);
  h=normalize(l+b.v);
  out.direction=outOfFrame(l,b.frame);
 }
 let diffusePdf=abs(dot(out.direction,s.normal))/PI;
 let ggx=ptGgxEval(l,b.v,h,b.alpha);
 let cloth=ptFuzzEval(b.fuzz,l,s.fuzzColor);
 var lobes=PtLobes(vec3f(0.0),0.0);
 if(transmit){
  lobes=ptAddLobe(lobes,b.diffuseWeight*s.transmit,diffusePdf,transmitProb);
  out.scatter=PT_SCATTER_DIFFUSE;
 }else if(diffuse){
  lobes=ptAddLobe(lobes,b.diffuseWeight*s.diffuse*ptShadowTerminator(out.direction,s.normal,s.vertexNormal),diffusePdf,b.diffuseProb-transmitProb);
  lobes.pdf+=b.specProb*ggx.y+ptFuzzProb(b)*cloth.w;
  out.scatter=PT_SCATTER_DIFFUSE;
 }else if(specular){
  lobes=ptAddLobe(lobes,ptSpecularWeight(b,h,ggx),ggx.y,b.specProb);
  lobes.pdf+=(b.diffuseProb-transmitProb)*diffusePdf+ptFuzzProb(b)*cloth.w;
  out.scatter=PT_SCATTER_SPECULAR;
 }else{
  lobes=ptAddLobe(lobes,cloth.xyz*ptShadowTerminator(out.direction,s.normal,s.vertexNormal),cloth.w,ptFuzzProb(b));
  lobes.pdf+=(b.diffuseProb-transmitProb)*diffusePdf+b.specProb*ggx.y;
  out.scatter=PT_SCATTER_SPECULAR;
 }
 out.weight=lobes.weight*s.selection;
 out.pdf=lobes.pdf;
 return out;
}
fn ptEvalMaterial(s:PtSurface,b:PtBsdf,world:vec3f,scale:vec2f)->PtEval{
 if(s.thin){return ptEvalThin(s,b,world,scale);}
 if(s.glass){return ptEvalGlass(s,b,world,scale);}
 let l=intoFrame(b.frame,world);
 let h=normalize(b.v+l);
 let diffuseCos=dot(world,s.normal);
 let diffusePdf=abs(diffuseCos)/PI;
 let transmitProb=b.diffuseProb*b.transmitProb;
 var lobes=PtLobes(vec3f(0.0),0.0);
 if(diffuseCos<0.0){
  lobes=ptAddLobe(lobes,scale.x*b.diffuseWeight*s.transmit,diffusePdf,transmitProb);
 }else{
  lobes=ptAddLobe(lobes,scale.x*b.diffuseWeight*s.diffuse*ptShadowTerminator(world,s.normal,s.vertexNormal),diffusePdf,b.diffuseProb-transmitProb);
 }
 let ggx=ptGgxEval(l,b.v,h,b.alpha);
 lobes=ptAddLobe(lobes,scale.y*ptSpecularWeight(b,h,ggx),ggx.y,b.specProb);
 if(s.fuzz>0.0){
  let cloth=ptFuzzEval(b.fuzz,l,s.fuzzColor);
  lobes=ptAddLobe(lobes,scale.y*cloth.xyz*ptShadowTerminator(world,s.normal,s.vertexNormal),cloth.w,ptFuzzProb(b));
 }
 return PtEval(lobes.weight*s.selection,lobes.pdf);
}
fn ptMaterialAlbedo(s:PtSurface)->vec3f{
 return select(s.diffuse+s.transmit+s.f0,vec3f(1.0),s.glass)+s.fuzz*s.fuzzColor;
}`,
)
