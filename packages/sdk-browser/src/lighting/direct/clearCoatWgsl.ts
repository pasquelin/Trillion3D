import { INVERSE_PI, PI } from '../../../../math/src/wgsl/constants.ts'
import { DIELECTRIC_F0, fresnelSchlick } from '../../../../math/src/wgsl/lighting.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { GGX_DISTRIBUTION_WGSL } from '../standardLighting.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LAMP_LOBE_WGSL } from './lampLobeWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from './shadingModelState.ts'

/**
 * THE CLEAR COAT, as one light sees it (`coatedLight`): a dielectric layer over the base, lit as the
 * reference's clear coat shading model lights it, step for step.
 *
 * The coat's weight `c` (`lobes.coat`), its roughness (held at 0.02 at least) and its normal `Nspec`
 * (`lobes.coatN`, the base's own unless the clear coat keeps a bottom normal, `clearCoatNormal`) make the top
 * layer: the half vector and the view's cosine of a context on `Nspec` and the light's highlight direction `L`,
 * moved by the light's sphere — its sine narrowed to the coat's roughness, the half vector found without the
 * Newton step where a bottom normal is kept —, its specular `c · direct · D · Vis · F` of a dielectric of
 * reflectance 0.04, its sphere's energy (`lobeEnergy`). What it lets through is `(1 − F)²`, F its Fresnel at the
 * half vector (the light goes in and comes out).
 *
 * The base is lit through it: a context of the base's normal where a bottom normal is kept, or the top layer's,
 * then the refraction of that context into the coat (`refractedCoat`, the one fixed index of 1.5), the
 * base's colour absorbing along the refracted path where it is a metal (`coatTransmittance`). Its diffuse is
 * `mix(d, (1 − F)² · T · d, c)`, `d` the plain Lambert diffuse; its specular `D₂ · Vis₂` of the refracted
 * view and the light's cosine, with the Fresnel of the plain context where there is no coat and of the refracted
 * one under it, `mix(F(plain), (1 − F)² · T · F(refracted), c)`. An anisotropic base takes its own
 * distribution and visibility along its tangent frame, in the coat's context.
 *
 * A rectangle brings the integral of its fitted lobe on the coat (`topLtc`) and on the base (`bottomLtc`), where
 * a point or a lamp brings the analytic terms, and the half vector's view cosine in place of the sphere's.
 * Energy conservation is the legacy one: none. `coatRemap` is what the indirect light sees of the base under
 * the coat: its diffuse and specular colours attenuated by the coat's absorption and the refraction.
 * `lobes` is the pixel's (`lobesWgsl.ts`).
 */
export const CLEAR_COAT_WGSL = wgslBlock(
  'CLEAR_COAT_WGSL',
  [
    PI,
    INVERSE_PI,
    fresnelSchlick,
    DIELECTRIC_F0,
    GGX_DISTRIBUTION_WGSL,
    SURFACE_F0_WGSL,
    LAMP_LOBE_WGSL,
    SHADING_MODEL_STATE_WGSL,
  ],
  `
struct CoatContext{NoL:f32,NoV:f32,NoH:f32,VoL:f32,VoH:f32,invH:f32,XoV:f32,XoL:f32,XoH:f32,YoV:f32,YoL:f32,YoH:f32,}
fn coatContextOf(N:vec3f,V:vec3f,L:vec3f)->CoatContext{
 var c:CoatContext;
 c.NoL=dot(N,L);c.NoV=dot(N,V);c.VoL=dot(V,L);
 c.invH=inverseSqrt(2.0+2.0*c.VoL);
 c.NoH=saturate((c.NoL+c.NoV)*c.invH);
 c.VoH=saturate(c.invH+c.invH*c.VoL);
 return c;
}
fn coatContextSkewed(N:vec3f,X:vec3f,Y:vec3f,V:vec3f,L:vec3f)->CoatContext{
 var c=coatContextOf(N,V,L);
 c.XoV=dot(X,V);c.XoL=dot(X,L);c.XoH=(c.XoL+c.XoV)*c.invH;
 c.YoV=dot(Y,V);c.YoL=dot(Y,L);c.YoH=(c.YoL+c.YoV)*c.invH;
 return c;
}
/** The context \`c\` seen through the coat: its dot products carried across the interface of index 1.5, the
 *  polynomial fit of the refraction's blend (\`RefractBlendClearCoatApprox\`), held off zero. */
fn refractedCoat(c:CoatContext)->CoatContext{
 var r=c;
 let eta=1.0/1.5;
 let blend=(0.63-0.22*c.VoH)*c.VoH-0.745;
 let projection=blend*c.NoH;
 r.NoV=clamp(eta*c.NoV-projection,0.001,1.0);
 r.NoL=clamp(eta*c.NoL-projection,0.001,1.0);
 r.VoH=saturate(eta*c.VoH-blend);
 r.VoL=2.0*r.VoH*r.VoH-1.0;
 r.NoH=c.NoH;
 return r;
}
/** What a metal base keeps of the light along the path through the coat, a slab of unit thickness: its colour
 *  the transmittance seen straight on (its extinction, taken once a pixel, \`setLobeBase\`), a path longer than two
 *  thicknesses absorbing the more; a dielectric keeps all. */
fn coatTransmittance(NoL:f32,NoV:f32)->vec3f{
 if(lobes.metal<=0.0){return vec3f(1.0);}
 let thin=1.0/NoV+1.0/NoL;
 let depth=lobes.extinction*max(thin-2.0,0.0);
 return mix(vec3f(1.0),exp(-depth),lobes.metal);
}
fn coatGgxSkewed(ax:f32,ay:f32,NoH:f32,XoH:f32,YoH:f32)->f32{
 let a2=ax*ay;
 let v=vec3f(ay*XoH,ax*YoH,a2*NoH);
 let s=dot(v,v);
 return (1.0/PI)*a2*(a2/s)*(a2/s);
}
fn coatVisSkewed(ax:f32,ay:f32,c:CoatContext)->f32{
 let vis_v=c.NoL*length(vec3f(ax*c.XoV,ay*c.YoV,c.NoV));
 let vis_l=c.NoV*length(vec3f(ax*c.XoL,ay*c.YoL,c.NoL));
 return 0.5/(vis_v+vis_l);
}
fn coatVisApprox(a2:f32,NoV:f32,NoL:f32)->f32{
 let a=sqrt(a2);
 return 0.5/(NoL*(NoV*(1.0-a)+a)+NoV*(NoL*(1.0-a)+a));
}
/** One light on the base \`s\` under the coat: its diffuse (column 0) and specular (column 1), \`direct\` the light's
 *  energy times its cosine \`cosine\` with the base's normal \`N\`, \`L\` the direction of its highlight, \`sine\` its sphere's
 *  sine as the base's roughness narrows it, \`soft\` its soft sphere's and \`lineCos\` the cosine a tube subtends;
 *  \`rect\` a rectangle, whose fitted lobes \`topLtc\` and \`bottomLtc\` the caller integrated. */
fn coatedLight(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,cosine:f32,direct:f32,sine:f32,soft:f32,lineCos:f32,rect:bool,topLtc:vec3f,bottomLtc:vec3f)->mat2x3f{
 let c=lobes.coat;
 let alphaCoat=lobes.coatAlpha;
 let Nspec=lobes.coatN;
 let skewed=hasSkew();
 let keepNewton=sphereNoNewton;
 var ctx=coatContextOf(Nspec,V,L);
 // The top layer: the sphere's sine as the coat's roughness narrows it.
 var compensation=1.0-s.alpha;
 compensation=select(0.0,(1.0-alphaCoat)/compensation,compensation>0.0);
 let topSine=saturate(sine*compensation);
 sphereNoNewton=clearCoatBottom;
 if(topSine>0.0){
  let m=sphereMoved(ctx.NoL,ctx.NoV,ctx.VoL,topSine);
  ctx.NoL=m.x;ctx.VoL=m.y;ctx.NoH=m.z;ctx.VoH=m.w;
 }
 ctx.NoV=saturate(abs(ctx.NoV)+1e-5);
 if(rect){ctx.VoH=ctx.NoV;}
 let F=fresnelSchlick(DIELECTRIC_F0,1.0,ctx.VoH).x;
 var specular=vec3f(0.0);
 if(rect){specular=c*topLtc;}
 else{
  let wide=lobeEnergy(alphaCoat*alphaCoat,ctx.VoH,topSine,soft,lineCos);
  let vis=coatVisApprox(wide.x,ctx.NoV,cosine);
  let D=ggxDistribution(wide.x,ctx.NoH,max(1.0-ctx.NoH*ctx.NoH,0.0))*wide.y;
  specular=vec3f(c*direct*D*vis*F);
 }
 let fresnel=(1.0-F)*(1.0-F);
 // The base: the context of its own normal where a bottom normal is kept.
 if(clearCoatBottom){
  let H=normalize(V+L);
  ctx.NoH=saturate(dot(N,H));ctx.NoV=saturate(dot(N,V));ctx.NoL=saturate(dot(N,L));
  ctx.VoL=saturate(dot(V,L));ctx.VoH=saturate(dot(V,H));
  if(!skewed&&sine>0.0){
   sphereNoNewton=false;
   let m=sphereMoved(ctx.NoL,ctx.NoV,ctx.VoL,sine);
   ctx.NoL=m.x;ctx.VoL=m.y;ctx.NoH=m.z;ctx.VoH=m.w;
  }
  ctx.NoV=saturate(abs(ctx.NoV)+1e-5);
 }
 sphereNoNewton=keepNewton;
 if(skewed){ctx=coatContextSkewed(Nspec,lobes.T,lobes.B,V,L);}
 var bottom=refractedCoat(ctx);
 if(rect){bottom.VoH=bottom.NoV;}
 let transmission=coatTransmittance(bottom.NoL,bottom.NoV);
 let plainDiffuse=direct*s.diffuse;
 let diffuse=mix(plainDiffuse,fresnel*transmission*plainDiffuse,c);
 if(!skewed&&rect){
  specular+=mix(bottomLtc,fresnel*transmission*bottomLtc,c);
 }else{
  var energy=1.0;
  var D2=0.0;
  var vis2=0.0;
  if(skewed){
   D2=coatGgxSkewed(lobes.at,lobes.ab,ctx.NoH,ctx.XoH,ctx.YoH);
   vis2=coatVisSkewed(lobes.at,lobes.ab,bottom);
  }else{
   let wide=lobeEnergy(s.alpha2,ctx.VoH,sine,soft,lineCos);
   energy=wide.y;
   vis2=coatVisApprox(wide.x,bottom.NoV,cosine);
   D2=ggxDistribution(wide.x,bottom.NoH,max(1.0-bottom.NoH*bottom.NoH,0.0));
  }
  let fBottom=fresnelSchlick(s.f0,s.f90,bottom.VoH);
  let fPlain=fresnelSchlick(s.f0,s.f90,ctx.VoH);
  specular+=(energy*direct*D2*vis2)*mix(fPlain,fresnel*transmission*fBottom,c);
 }
 return mat2x3f(diffuse,specular);
}
/** The coat's light of a light of no size: the direction \`L\` unit, \`energy\` its intensity through its falloff. */
fn coatedPoint(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,energy:f32)->mat2x3f{
 let cosine=max(dot(N,L),0.0);
 return coatedLight(s,N,V,L,cosine,energy*cosine,0.0,0.0,1.0,false,vec3f(0.0),vec3f(0.0));
}
/** The coat's light of a lamp of size, its \`look\` (the highlight's direction, its sphere) and \`lamp\`. */
fn coatedLamp(s:LobeSurface,N:vec3f,V:vec3f,look:Look,lamp:Lamp,energy:f32)->mat2x3f{
 return coatedLight(s,N,V,look.toward,lamp.cosine,energy*lamp.cosine,saturate(look.reach*(1.0-s.alpha)),saturate(look.soft),lamp.lineCos,false,vec3f(0.0),vec3f(0.0));
}
/** What the indirect light sees of the base under the coat: its colour attenuated by the coat's Fresnel along the view
 *  (\`lobes.coatNoV\`) and, for a metal, replaced by its absorbed colour under the refraction; the diffuse colour from it,
 *  and the reflectance of the specular the refraction scales. */
struct CoatRemap{diffuse:vec3f,specular:vec3f,}
fn coatRemap(rgb:vec3f,metal:f32)->CoatRemap{
 let c=lobes.coat;
 let NoV=lobes.coatNoV;
 let refraction=((NoV*0.5+0.5)*NoV-1.0)*saturate(1.25-1.25*lobes.baseRough)+1.0;
 let metalSpec=0.9;
 let absorptionColour=rgb*(1.0/metalSpec);
 let absorption=absorptionColour*((NoV-1.0)*0.85*(1.0-mix(absorptionColour,absorptionColour*absorptionColour,vec3f(-0.78)))+1.0);
 let F=fresnelSchlick(DIELECTRIC_F0,1.0,NoV).x;
 let attenuation=mix(1.0,1.0-F,c);
 let base=mix(rgb*attenuation,metalSpec*absorption*refraction,metal*c);
 let specular=mix(surfaceSpecular,refraction,c);
 return CoatRemap(base-base*metal,mix(vec3f(0.08*specular),base,metal));
}`,
)
