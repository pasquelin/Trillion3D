import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LAMP_WGSL } from './lampSeenWgsl.ts'
import { lightTraits } from './lightReachWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from './shadingModelState.ts'

/**
 * A LAMP OF SIZE'S HIGHLIGHT: what its shape does to the specular lobe, on top of the cosine and the
 * falloff it gives the diffuse (`lampSeenWgsl.ts`).
 *
 * - Where the highlight comes from: the point of the lamp the reflection ray comes closest to — for
 *   a tube, `lineClosest` on its line, the ray from the surface's reflection of the view; for a
 *   sphere or a point, its centre —, seen as `Look.toward`; `reach` is the source's radius over that
 *   distance, `soft` the soft radius over it and `micro` the weight of its rough diffuse
 *   (`lobeDiffuse`): 1 for a source of no size, fading to 0 as its radius or its length reaches
 *   `ROUGH_DIFFUSE_FADE_METRES` (`scene/light/fields.ts`), worked out once with the light (`sourceTermOf`).
 * - The sphere widens the lobe and keeps its energy: the half vector is moved to the nearest the
 *   sphere lets it get to the normal (`sphereHalfCosines`, with one Newton step toward the exact
 *   nearest), the distribution's α² grows by `α² + ¼ s (3 √α² + s) / (V·H + 0.001)` for `s` the
 *   sphere's sine, and the lobe is multiplied by the ratio of the two α² (`lobeEnergy`); a tube does
 *   the same for the angle it subtends, `tan` of half of it for `s`; the soft radius widens α²
 *   alone, by `s² / (3.6 V·H + 0.4)`, and the energy ratio is that of the widened lobe.
 * - The diffuse and the visibility take the lamp's cosine (wrapped about the horizon, a tube's
 *   vector irradiance), the distribution and Fresnel the moved half vector.
 *
 * The lobe is `lobeSum`, as the standard and anisotropic lobes' are: its diffuse share and its
 * specular one, the Smith joint visibility's blend (`jointHalf`).
 *
 * Where an inverse or a root has nothing to give — a lamp's own centre, a reflection ray that
 * leaves the half vector nothing to turn on, two ends of a tube seen opposite — its value is
 * nothing (`safeRcp`, `safeInverseSqrt`), the finite one the lobe takes there.
 */
export const LAMP_LOBE_WGSL = wgslBlock(
  'LAMP_LOBE_WGSL',
  [STANDARD_LIGHTING_WGSL, LAMP_WGSL, safeRcp, SHADING_MODEL_STATE_WGSL, lightTraits],
  `
/** One over the root of \`x\`, nothing where it is nothing or below. */
fn safeInverseSqrt(x:f32)->f32{return safeRcp(sqrt(max(x,0.0)));}
/** Where a lamp's highlight comes from: the unit direction \`toward\` the nearest point of it to the
 *  reflection, the source's radius and soft radius over the distance to it. */
struct Look{toward:vec3f,reach:f32,soft:f32,micro:f32,}
/** The point of the line from \`p0\` along \`line\` nearest the ray along \`R\` from the origin; the line's
 *  start where the two are parallel. */
fn lineClosest(p0:vec3f,line:vec3f,R:vec3f)->vec3f{
 let b=dot(R,line);
 let den=dot(line,line)-b*b;
 return p0+line*select(0.0,saturate(dot(p0,b*R-line)/den),den>0.0);
}
/** The look of a lamp \`offset\` away from the point, of tube \`halfAxis\` each side (zero: none), of
 *  source \`radius\` and \`soft\` radius, and \`micro\` the weight of its rough diffuse, for the surface of normal N seen along V. */
fn capsuleLook(offset:vec3f,halfAxis:vec3f,radius:f32,soft:f32,micro:f32,N:vec3f,V:vec3f)->Look{
 var to=offset;
 if(any(halfAxis!=vec3f(0.0))){to=lineClosest(offset-halfAxis,2.0*halfAxis,2.0*dot(N,V)*N-V);}
 let inv=safeRcp(length(to));
 return Look(to*inv,radius*inv,soft*inv,micro);
}
/** The look of the lamp \`lamp\` of \`light\` seen from \`P\` at normal N along V: a sun's disk — the sun's direction, the sine of its angular
 *  radius (\`sourceTermOf\`, written with the light), the sine of half its soft angle and a full weight of the rough diffuse —
 *  or a capsule's (\`capsuleLook\`), its weight of the rough diffuse written with the light too (\`sourceTermOf\`). */
fn lampLook(light:DirectLight,P:vec3f,N:vec3f,V:vec3f,lamp:Lamp)->Look{
 if(isSun(light)){return Look(lamp.toward,sourceTermOf(light),light.capsule.w,1.0);}
 return capsuleLook(light.positionRange.xyz-P,tubeHalfAxisOf(light),light.shape.x,light.capsule.w,sourceTermOf(light),N,V);
}
/** The lobe's α² widened by a source of sine \`s\` at half-vector cosine \`VoH\`. */
fn widerAlpha2(a2:f32,s:f32,VoH:f32)->f32{return a2+0.25*s*(3.0*sqrt(a2)+s)/(VoH+0.001);}
/** The lobe's α² after the soft radius widened it, and the energy the sphere's and the tube's
 *  widenings take from the peak and give back as width. */
fn lobeEnergy(a2:f32,VoH:f32,sine:f32,softSine:f32,lineCos:f32)->vec2f{
 var a=a2;
 if(softSine>0.0){a=saturate(a+softSine*softSine/(VoH*3.6+0.4));}
 var sphere=a;var energy=1.0;
 if(sine>0.0){sphere=widerAlpha2(a,sine,VoH);energy=a/sphere;}
 if(lineCos<1.0){
  // Seen opposite (\`lineCos\` −1) the tube subtends a half turn: the widening is without bound and
  // the lobe's energy nothing.
  let opposite=1.0+lineCos;
  if(opposite>0.0){
   let lineTan=sqrt((1.0001-lineCos)/opposite);
   energy*=sqrt(sphere/max(widerAlpha2(sphere,lineTan,VoH),1e-5));
  }else{energy=0.0;}
 }
 return vec2f(a,energy);
}
/** The half-vector's cosines with the normal and the view, moved to the nearest a sphere of sine
 *  \`sine\` seen along L lets them get: the lamp's disk reflects the view where the reflection falls
 *  inside it (the half vector the normal's, the view's cosine N·V), else its edge nearest it,
 *  placed by one Newton step on the direction around the disk. \`NoL\`, \`NoV\`, \`VoL\` are the dots of
 *  the normal, the light and the view. */
fn sphereMoved(NoL:f32,NoV:f32,VoL:f32,sine:f32)->vec4f{
 let cosAlpha=sqrt(1.0-sine*sine);
 let RoL=2.0*NoL*NoV-VoL;
 if(RoL>=cosAlpha){return vec4f(NoL,VoL,1.0,abs(NoV));}
 let rInvLengthT=sine*safeInverseSqrt(1.0-RoL*RoL);
 var NoTr=rInvLengthT*(NoV-RoL*NoL);
 var VoTr=rInvLengthT*(2.0*NoV*NoV-1.0-RoL*VoL);
 // The eye's specular lobe and a coat over a bottom normal move the half-vector without the Newton step.
 if(!sphereNoNewton){
  let NxLoV=sqrt(saturate(1.0-NoL*NoL-NoV*NoV-VoL*VoL+2.0*NoL*NoV*VoL));
  let NoBr=rInvLengthT*NxLoV;
  let VoBr=rInvLengthT*NxLoV*2.0*NoV;
  let NoLVTr=NoL*cosAlpha+NoV+NoTr;
  let VoLVTr=VoL*cosAlpha+1.0+VoTr;
  let p=NoBr*VoLVTr;
  let q=NoLVTr*VoLVTr;
  let r=VoBr*NoLVTr;
  let xNum=q*(-0.5*p+0.25*VoBr*NoLVTr);
  let xDenom=p*p+r*(r-2.0*p)+NoLVTr*((NoL*cosAlpha+NoV)*VoLVTr*VoLVTr+q*(-0.5*(VoLVTr+VoL*cosAlpha)-0.5));
  let twoX1=2.0*xNum*safeRcp(xDenom*xDenom+xNum*xNum);
  let sinTheta=twoX1*xDenom;
  let cosTheta=1.0-twoX1*xNum;
  NoTr=cosTheta*NoTr+sinTheta*NoBr;
  VoTr=cosTheta*VoTr+sinTheta*VoBr;
 }
 let moved=clamp(VoL*cosAlpha+VoTr,-1.0,1.0);
 let invLenH=safeInverseSqrt(2.0+2.0*moved);
 let movedNoL=NoL*cosAlpha+NoTr;
 return vec4f(movedNoL,moved,saturate((movedNoL+NoV)*invLenH),saturate(invLenH+invLenH*moved));
}
/** The half-vector's cosines of \`sphereMoved\` alone. */
fn sphereHalfCosines(NoL:f32,NoV:f32,VoL:f32,sine:f32)->vec2f{return sphereMoved(NoL,NoV,VoL,sine).zw;}
/** The half-vector of a lamp's look on the surface \`s\` of normal N seen along V, as \`lampLobe\` and
 *  the cloth lobe take it: its cosines with the normal (\`x\`) and the view (\`y\`), moved toward
 *  the nearest a sphere lets it get (\`sphereHalfCosines\`), and the sphere's sine (\`z\`), the
 *  lamp's radius over its distance, narrowed by the lobe's width. */
fn lampHalf(s:LobeSurface,N:vec3f,V:vec3f,look:Look)->vec3f{
 let NoL=dot(N,look.toward);let NoV=dot(N,V);let VoL=dot(V,look.toward);
 let invLenH=safeInverseSqrt(2.0+2.0*VoL);
 var NoH=saturate((NoL+NoV)*invLenH);var VoH=saturate(invLenH+invLenH*VoL);
 let sine=saturate(look.reach*(1.0-s.alpha));
 if(sine>0.0){let moved=sphereHalfCosines(NoL,NoV,VoL,sine);NoH=moved.x;VoH=moved.y;}
 return vec3f(NoH,VoH,sine);
}
/** A surface's lobe lit by a lamp of size, on the surface \`s\` of normal N seen along V: the lamp's
 *  \`look\`, the \`cosine\` it takes light by and the tube's \`lineCos\`, \`energy\` the light's intensity
 *  through its falloff and shadow. Diffuse and specular, before the colour. */
fn lampLobe(s:LobeSurface,N:vec3f,V:vec3f,look:Look,cosine:f32,lineCos:f32,energy:f32)->vec3f{
 return lampLobeWith(lampHalf(s,N,V,look),s,V,look,cosine,lineCos,energy);
}
/** \`lampLobe\` of the lamp's half-vector \`h\` (\`lampHalf\`), which a caller that needs it too takes once. The rough diffuse is taken at the
 *  lamp's own cosine and its direction to the view, before the sphere moves the half-vector. */
fn lampLobeWith(h:vec3f,s:LobeSurface,V:vec3f,look:Look,cosine:f32,lineCos:f32,energy:f32)->vec3f{
 let NoH=h.x;let VoH=h.y;let sine=h.z;
 let wide=lobeEnergy(s.alpha2,VoH,sine,saturate(look.soft),lineCos);
 let alpha=sqrt(wide.x);
 let D=ggxDistribution(wide.x,NoH,max(1.0-NoH*NoH,0.0))*wide.y;
 let gV=cosine*jointHalf(s.NdotV,alpha,s.accurate);
 let gL=s.NdotV*jointHalf(cosine,alpha,s.accurate);
 return lobeSum(s,lobeDiffuse(s,cosine,dot(V,look.toward),look.micro),D,gV,gL,VoH,energy*cosine);
}`,
)

/**
 * A pixel's light from a lamp of size, in full: the base lobe, or under a coat the coat model's, the hooks
 * `baseLampLobe`, `hasCoat` and `coatedLamp` the block that lists this one declares
 * (`lobesWgsl.ts`: the lobed one, or the lobeless one's plain lobe and no coat) — the lamp of no size
 * is `surfaceLight`'s (`standardLighting.ts`). `lampLight` is the one call of both.
 */
export const LAMP_SURFACE_LIGHT_WGSL = wgslBlock(
  'LAMP_SURFACE_LIGHT_WGSL',
  [LAMP_LOBE_WGSL],
  `
fn lampLight(s:LobeSurface,N:vec3f,V:vec3f,light:DirectLight,P:vec3f,lamp:Lamp,energy:f32)->vec3f{
 if(!lamp.capsule){return surfaceLight(s,N,V,vec4f(lamp.toward,energy));}
 return lampLightLooked(s,N,V,lampLook(light,P,N,V,lamp),lamp,energy);
}
/** The light of a lamp of size whose \`look\` the caller has taken (\`lampLook\`, once a light): the base lobe, or under a coat the coat model's. */
fn lampLightLooked(s:LobeSurface,N:vec3f,V:vec3f,look:Look,lamp:Lamp,energy:f32)->vec3f{
 if(hasCoat()){
  let coated=coatedLamp(s,N,V,look,lamp,energy);
  return coated[0]+coated[1];
 }
 return baseLampLobe(s,N,V,look,lamp,energy);
}
/** The same in its two shares (\`lampLightSplit\`), \`share.x\` of the diffuse light and \`share.y\` of the specular. */
fn lampLightShares(s:LobeSurface,N:vec3f,V:vec3f,light:DirectLight,P:vec3f,lamp:Lamp,energy:f32,share:vec2f)->vec3f{
 let split=lampLightSplit(s,N,V,light,P,lamp,energy);
 return split[0]*share.x+split[1]*share.y;
}
/** A light's diffuse (column 0) and specular (column 1) on the surface: the diffuse of the lamp's cosine and direction to the view
 *  (\`lobeDiffuse\`, Lambert's or the rough diffuse, as the whole term takes it), and what the surface with no diffuse light gives
 *  (\`lampLight\` of \`withoutDiffuse\`); under a coat the coat model's two terms. */
fn lampLightSplit(s:LobeSurface,N:vec3f,V:vec3f,light:DirectLight,P:vec3f,lamp:Lamp,energy:f32)->mat2x3f{
 if(hasCoat()){
  if(!lamp.capsule){return coatedPoint(s,N,V,lamp.toward,energy);}
  return coatedLamp(s,N,V,lampLook(light,P,N,V,lamp),lamp,energy);
 }
 let bare=withoutDiffuse(s);
 if(!lamp.capsule){
  return mat2x3f(lobeDiffuse(s,lamp.cosine,dot(V,lamp.toward),1.0)*(energy*lamp.cosine),surfaceLight(bare,N,V,vec4f(lamp.toward,energy)));
 }
 let look=lampLook(light,P,N,V,lamp);
 return mat2x3f(lobeDiffuse(s,lamp.cosine,dot(V,look.toward),look.micro)*(energy*lamp.cosine),lampLightLooked(bare,N,V,look,lamp,energy));
}`,
)
