import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LAMP_WGSL } from './lampSeenWgsl.ts'

/**
 * A LAMP OF SIZE'S HIGHLIGHT: what its shape does to the specular lobe, on top of the cosine and the
 * falloff it gives the diffuse (`lampSeenWgsl.ts`).
 *
 * - Where the highlight comes from: the point of the lamp the reflection ray comes closest to — for
 *   a tube, `lineClosest` on its line, the ray from the surface's reflection of the view; for a
 *   sphere or a point, its centre —, seen as `Look.toward`; `reach` is the source's radius over that
 *   distance and `soft` the soft radius over it.
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
 * specular one, the Smith joint visibility.
 */
export const LAMP_LOBE_WGSL = wgslBlock(
  'LAMP_LOBE_WGSL',
  [STANDARD_LIGHTING_WGSL, LAMP_WGSL],
  `
/** Where a lamp's highlight comes from: the unit direction \`toward\` the nearest point of it to the
 *  reflection, the source's radius and soft radius over the distance to it. */
struct Look{toward:vec3f,reach:f32,soft:f32,}
/** The point of the line from \`p0\` along \`line\` nearest the ray along \`R\` from the origin; the line's
 *  start where the two are parallel. */
fn lineClosest(p0:vec3f,line:vec3f,R:vec3f)->vec3f{
 let b=dot(R,line);
 let den=dot(line,line)-b*b;
 return p0+line*select(0.0,saturate(dot(p0,b*R-line)/den),den>0.0);
}
/** The look of a lamp \`offset\` away from the point, of tube \`halfAxis\` each side (zero: none), of
 *  source \`radius\` and \`soft\` radius, for the surface of normal N seen along V. */
fn capsuleLook(offset:vec3f,halfAxis:vec3f,radius:f32,soft:f32,N:vec3f,V:vec3f)->Look{
 var to=offset;
 if(any(halfAxis!=vec3f(0.0))){to=lineClosest(offset-halfAxis,2.0*halfAxis,2.0*dot(N,V)*N-V);}
 let inv=inverseSqrt(max(dot(to,to),1e-12));
 return Look(to*inv,radius*inv,soft*inv);
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
  let lineTan=sqrt((1.0001-lineCos)/max(1.0+lineCos,1e-6));
  energy*=sqrt(sphere/max(widerAlpha2(sphere,lineTan,VoH),1e-5));
 }
 return vec2f(a,energy);
}
/** The half-vector's cosines with the normal and the view, moved to the nearest a sphere of sine
 *  \`sine\` seen along L lets them get: the lamp's disk reflects the view where the reflection falls
 *  inside it (the half vector the normal's, the view's cosine N·V), else its edge nearest it,
 *  placed by one Newton step on the direction around the disk. \`NoL\`, \`NoV\`, \`VoL\` are the dots of
 *  the normal, the light and the view. */
fn sphereHalfCosines(NoL:f32,NoV:f32,VoL:f32,sine:f32)->vec2f{
 let cosAlpha=sqrt(1.0-sine*sine);
 let RoL=2.0*NoL*NoV-VoL;
 if(RoL>=cosAlpha){return vec2f(1.0,abs(NoV));}
 let rInvLengthT=sine*inverseSqrt(max(1.0-RoL*RoL,1e-12));
 var NoTr=rInvLengthT*(NoV-RoL*NoL);
 var VoTr=rInvLengthT*(2.0*NoV*NoV-1.0-RoL*VoL);
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
 let twoX1=2.0*xNum/max(xDenom*xDenom+xNum*xNum,1e-20);
 let sinTheta=twoX1*xDenom;
 let cosTheta=1.0-twoX1*xNum;
 NoTr=cosTheta*NoTr+sinTheta*NoBr;
 VoTr=cosTheta*VoTr+sinTheta*VoBr;
 let moved=clamp(VoL*cosAlpha+VoTr,-1.0,1.0);
 let invLenH=inverseSqrt(max(2.0+2.0*moved,1e-12));
 return vec2f(saturate((NoL*cosAlpha+NoTr+NoV)*invLenH),saturate(invLenH+invLenH*moved));
}
/** A surface's lobe lit by a lamp of size, on the surface \`s\` of normal N seen along V: the lamp's
 *  \`look\`, the \`cosine\` it takes light by and the tube's \`lineCos\`, \`energy\` the light's intensity
 *  through its falloff and shadow. Diffuse and specular, before the colour. */
fn lampLobe(s:LobeSurface,N:vec3f,V:vec3f,look:Look,cosine:f32,lineCos:f32,energy:f32)->vec3f{
 let NoL=dot(N,look.toward);let NoV=dot(N,V);let VoL=dot(V,look.toward);
 let invLenH=inverseSqrt(max(2.0+2.0*VoL,1e-12));
 var NoH=saturate((NoL+NoV)*invLenH);var VoH=saturate(invLenH+invLenH*VoL);
 let sine=saturate(look.reach*(1.0-sqrt(s.alpha2)));
 if(sine>0.0){let moved=sphereHalfCosines(NoL,NoV,VoL,sine);NoH=moved.x;VoH=moved.y;}
 let wide=lobeEnergy(s.alpha2,VoH,sine,saturate(look.soft),lineCos);
 var t=s;
 t.alpha2=wide.x;t.rest=1.0-wide.x;t.viewG=sqrt(s.NdotV*s.NdotV*t.rest+t.alpha2);
 let D=ggxDistribution(t.alpha2,NoH,max(1.0-NoH*NoH,0.0))*wide.y;
 let gV=cosine*t.viewG;
 let gL=s.NdotV*sqrt(cosine*cosine*t.rest+t.alpha2);
 return lobeSum(t,D,gV,gL,VoH,energy*cosine);
}`,
)

/**
 * A pixel's light from a lamp of size, in full: the base lobe and, under a coat, the coat's own,
 * the hooks `baseLampLobe` and `coatLampLobe` the block that lists this one declares
 * (`lobesWgsl.ts`: the lobed one, or the lobeless one's plain lobe and no coat) — the lamp of no size
 * is `surfaceLight`'s (`standardLighting.ts`). `lampLight` is the one call of both.
 */
export const LAMP_SURFACE_LIGHT_WGSL = wgslBlock(
  'LAMP_SURFACE_LIGHT_WGSL',
  [LAMP_LOBE_WGSL],
  `
fn lampLight(s:LobeSurface,N:vec3f,V:vec3f,light:DirectLight,P:vec3f,lamp:Lamp,energy:f32)->vec3f{
 if(!lamp.capsule){return surfaceLight(s,N,V,vec4f(lamp.toward,energy));}
 let look=capsuleLook(light.positionRange.xyz-P,light.capsule.xyz,light.shape.x,light.capsule.w,N,V);
 return baseLampLobe(s,N,V,look,lamp,energy)*lobeThrough()+coatLampLobe(V,look,lamp,energy);
}`,
)
