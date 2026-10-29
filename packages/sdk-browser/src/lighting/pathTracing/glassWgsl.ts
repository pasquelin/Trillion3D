import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { Frame3, intoFrame, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { GLASS_ENERGY_SIZE } from '../../../../sdk-core/src/lighting/glassEnergy.ts'
import { PT_DIELECTRIC_WGSL } from './dielectricWgsl.ts'
import { PT_FUZZ_WGSL } from './fuzzWgsl.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'
import { PT_SURFACE_WGSL } from './surfaceWgsl.ts'

const N = GLASS_ENERGY_SIZE

/**
 * THE GLASS OF THE PATH TRACER: a rough dielectric interface (`dielectricWgsl.ts`) under a possible fuzz, lit by sampling its reflection and refraction by the Fresnel term.
 * `ptGlassEnergy(roughness, noV, eta)` is the directional albedo of the interface from the table in the lights' buffer (`directLights.glass`, `glassEnergy.ts`): read at the view cosine, the roughness and the
 * index, trilinear, held to the edge; the index read is the larger of `eta` and its inverse over the table's range, the albedo from outside for `eta` of one or more and from inside under it. The glass lobes
 * are divided by it, so a rough glass keeps the energy its single scattering misses.
 * `ptPrepareGlass(s, b)` fixes the interface for the surface `s` in the prepared `b`: the relative index (the surface's on a front face, its inverse on a back face), that energy, the fuzz and the chance
 * of sampling the glass among the glass and the fuzz (by the sum of their colours, `ptMisBalance`).
 * `ptSampleGlass(s, b, e)` draws the glass or the fuzz; the glass a half vector, the reflection or the refraction by the Fresnel term (a refraction moves the ray's origin to the other side of the
 * surface: `positionBias` of minus one, and the sample is a `PT_SCATTER.refract`, which does not decide what the path's first scatter is); `ptEvalGlass(s, b, world, scale)` is the weight and the density of a direction given.
 */
export const PT_GLASS_WGSL = wgslBlock(
  'PT_GLASS_WGSL',
  [
    Frame3,
    intoFrame,
    outOfFrame,
    PT_SURFACE_WGSL,
    PT_DIELECTRIC_WGSL,
    PT_FUZZ_WGSL,
    PT_MONTE_CARLO_WGSL,
  ],
  `fn ptGlassTexel(x:i32,y:i32,z:i32)->vec2f{
 let at=u32(clamp(z,0,${N - 1}))*${N * N}u+u32(clamp(y,0,${N - 1}))*${N}u+u32(clamp(x,0,${N - 1}));
 return unpack2x16unorm(directLights.glass[at]);
}
fn ptGlassEnergy(rough:f32,noV:f32,eta:f32)->f32{
 let p=vec3f(noV,rough,max(eta,1.0/eta)*0.5-0.5)*${N}.0-0.5;
 let f=floor(p);
 let t=p-f;
 let x=i32(f.x);let y=i32(f.y);let z=i32(f.z);
 let near=mix(mix(ptGlassTexel(x,y,z),ptGlassTexel(x+1,y,z),t.x),mix(ptGlassTexel(x,y+1,z),ptGlassTexel(x+1,y+1,z),t.x),t.y);
 let far=mix(mix(ptGlassTexel(x,y,z+1),ptGlassTexel(x+1,y,z+1),t.x),mix(ptGlassTexel(x,y+1,z+1),ptGlassTexel(x+1,y+1,z+1),t.x),t.y);
 let e=mix(near,far,t.z);
 return select(e.y,e.x,eta>=1.0);
}
fn ptGlassReflectance(s:PtSurface)->f32{return max(s.f0.x,max(s.f0.y,s.f0.z));}
fn ptPrepareGlass(s:PtSurface,b:PtBsdf)->PtBsdf{
 var out=b;
 out.eta=select(1.0/s.ior,s.ior,s.front);
 out.glassEnergy=max(ptGlassEnergy(max(s.roughness,0.01),saturate(b.v.z),out.eta),1.0e-4);
 let fuzzAlbedo=b.fuzz.scale*s.fuzzColor;
 out.glassProb=ptMisBalance(3.0*b.fuzz.keep,fuzzAlbedo.x+fuzzAlbedo.y+fuzzAlbedo.z);
 return out;
}
fn ptSampleGlass(s:PtSurface,b:PtBsdf,e:vec3f)->PtSample{
 var out:PtSample;
 out.positionBias=1.0;
 out.roughness=1.0;
 var lobes=PtLobes(vec3f(0.0),0.0);
 var l:vec3f;
 if(e.x<b.glassProb){
  let g=ptGlassSample(b.v,b.alpha,b.eta,ptGlassReflectance(s),vec3f(ptRescale(e.x,0.0,b.glassProb),e.y,e.z));
  l=normalize(g.direction);
  lobes=ptAddLobe(lobes,vec3f(g.weight/b.glassEnergy),g.pdf,b.glassProb);
  out.roughness=s.roughness;
  if(g.refracted){
   out.positionBias=-1.0;
   out.scatter=PT_SCATTER_REFRACT;
  }else{
   lobes.pdf+=(1.0-b.glassProb)*ptFuzzEval(b.fuzz,l,s.fuzzColor).w;
   out.scatter=PT_SCATTER_SPECULAR;
  }
  lobes.weight*=b.fuzz.keep;
 }else{
  l=ptFuzzSample(b.fuzz,vec2f(ptRescale(e.x,b.glassProb,1.0),e.y));
  let cloth=ptFuzzEval(b.fuzz,l,s.fuzzColor);
  let g=ptGlassEval(l,b.v,b.alpha,b.eta,ptGlassReflectance(s));
  lobes=ptAddLobe(lobes,cloth.xyz,cloth.w,1.0-b.glassProb);
  lobes.pdf+=b.glassProb*g.y;
  out.scatter=PT_SCATTER_SPECULAR;
 }
 out.direction=outOfFrame(l,b.frame);
 out.weight=lobes.weight*s.selection;
 out.pdf=lobes.pdf;
 return out;
}
fn ptEvalGlass(s:PtSurface,b:PtBsdf,world:vec3f,scale:vec2f)->PtEval{
 let l=intoFrame(b.frame,world);
 let g=ptGlassEval(l,b.v,b.alpha,b.eta,ptGlassReflectance(s));
 var lobes=PtLobes(vec3f(0.0),0.0);
 lobes=ptAddLobe(lobes,vec3f(scale.y*b.fuzz.keep*g.x/b.glassEnergy),g.y,b.glassProb);
 if(l.z>0.0){
  let cloth=ptFuzzEval(b.fuzz,l,s.fuzzColor);
  lobes=ptAddLobe(lobes,scale.y*cloth.xyz,cloth.w,1.0-b.glassProb);
 }
 return PtEval(lobes.weight*s.selection,lobes.pdf);
}`,
)
