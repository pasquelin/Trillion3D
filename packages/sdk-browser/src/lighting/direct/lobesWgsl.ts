import { INVERSE_PI, PI } from '../../../../math/src/wgsl/constants.ts'
import { LOBE_PACK_WGSL, PHYSICAL_LOBES_TARGET } from '../../materials/surface/physicalLobes.ts'
import { LOBE_AXIS_WGSL } from '../lobeAxisWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SURFACE_LIGHT_WGSL } from '../standardLighting.ts'
import { LAMP_SURFACE_LIGHT_WGSL } from './lampLobeWgsl.ts'
import { CLOTH_SHEEN_WGSL, SHEEN_LOBE_WGSL, SHEEN_RECT_WGSL } from './sheenLobeWgsl.ts'
import { SHADING_MODEL_PIXEL_WGSL } from './shadingModelWgsl.ts'
import { CLEAR_COAT_WGSL } from './clearCoatWgsl.ts'
import { ENERGY_TERMS_WGSL } from './energyTermsWgsl.ts'
import { RECT_SURFACE_LIGHT_WGSL } from './rectLightWgsl.ts'
import {
  DIELECTRIC_F0,
  clampNoV,
  envBrdfF90,
  ndotvClamped,
  slabF90,
} from '../../../../math/src/wgsl/lighting.ts'

/**
 * The lighting of the physical material's anisotropic, clear-coat and cloth lobes
 * (`../../materials/surface/physicalLobes.ts`): in the lit passes'
 * programs for the tiles that have them (`CLASS_CUTS`, `key.lobeless` false), which read a
 * pixel's lobes from the lobes target (`LOBES_TARGET_WGSL`), in the blend pass's lobed programs,
 * which compute them in place (`../../blend/physicalWgsl.ts`).
 * Each sets them once a pixel (`setLobes`) where it carries them, and every term below falls back
 * on the standard one, operand for operand, on a pixel that does not.
 *
 * Anisotropic GGX: αt = α(1 + s) along the direction T, αb = α(1 − s) across it (`../lobeAxisWgsl.ts`),
 * the distribution 1 / (π αt αb |(T·H/αt, B·H/αb, N·H)|⁴) and its height-correlated visibility.
 * A clear coat is the reference's clear coat model (`clearCoatWgsl.ts`): a pixel whose coat is above zero is lit
 * by `coatedPoint`, `coatedLamp` and the rectangle's `coatedRect`, which replace the base's lobes whole; the indirect
 * light sees its base through the coat's absorption (`coatRemap`, by `clothDiffuse` for the diffuse colour and
 * `indirectF0` for the specular's) and its reflections as the two layers' mix (`coatLayerKeep`).
 * A cloth (`setCloth`, the cloth model has no coat and no anisotropy) is a fuzz of fibres over its base
 * (`sheenLobeWgsl.ts`): each light adds the fuzz lobe's light (`sheenFuzz`, its colour times the cloth
 * amount, the light's energy and the lobe's albedo) and leaves the base's diffuse and specular one minus the cloth amount
 * times that albedo of theirs (`clothMix`, `sheenKeep`); the base's reflectance is masked by the cloth amount
 * (`clothSurface`, the legacy cloth's conversion). The indirect light does the same: the fuzz colour times the cloth amount
 * and the albedo is added to the diffuse colour of the indirect light, which keeps the same share of its own
 * (`clothDiffuse`), as does the specular's weight (`indirectKeep`). What a pixel's lights share is
 * taken once: αt, αb, their reciprocals and the distribution's scale 1/(π αt αb) (a light's T·H/αt
 * is a product, its D a quotient by q², the same 8-bit image, `lobeLight.test.ts`), the view's
 * length in the stretched frame, the base's surface before its light loop (`sliceLighting`), a light's
 * direction and half-vector once (`standardLobe`). A rectangle stretches its polygon in the direction's
 * frame before its fitted lobe.
 */
export const LOBES_LIGHTING_WGSL = wgslBlock(
  'LOBES_LIGHTING_WGSL',
  [
    PI,
    INVERSE_PI,
    DIELECTRIC_F0,
    envBrdfF90,
    ndotvClamped,
    clampNoV,
    ENERGY_TERMS_WGSL,
    LOBE_AXIS_WGSL,
    SURFACE_LIGHT_WGSL,
    LAMP_SURFACE_LIGHT_WGSL,
    SHEEN_LOBE_WGSL,
    CLOTH_SHEEN_WGSL,
    slabF90,
    SHADING_MODEL_PIXEL_WGSL,
    CLEAR_COAT_WGSL,
  ],
  `
struct Lobes{cloth:f32,fuzz:vec3f,sheen:SheenView,on:bool,skewed:bool,T:vec3f,B:vec3f,coat:f32,coatRough:f32,coatN:vec3f,coatAlpha:f32,coatNoV:f32,baseColour:vec3f,extinction:vec3f,metal:f32,baseRough:f32,at:f32,ab:f32,invAt:f32,invAb:f32,dScale:f32,view:vec2f,viewLength:f32,}
var<private> lobes:Lobes;
fn hasCloth()->bool{return lobes.on&&lobes.cloth>0.0;}
fn hasSkew()->bool{return lobes.on&&lobes.skewed;}
fn hasCoat()->bool{return lobes.on&&lobes.coat>0.0;}
/** A pixel's lobes: its lobe axis \`axis\` (\`lobeAxis\`: the direction kept orthogonal to the normal the
 *  lighting reads and the width along it, or the round lobe), \`alpha\` the width across it
 *  (\`lobeAcross\`), and what its lights share of them. */
fn setLobes(axis:vec4f,coat:f32,coatRough:f32,coatN:vec3f,N:vec3f,V:vec3f,alpha:f32){
 lobes.on=true;
 lobes.cloth=0.0;lobes.fuzz=vec3f(0.0);
 lobes.skewed=any(axis.xyz!=vec3f(0.0));
 lobes.T=axis.xyz;
 lobes.B=cross(N,lobes.T);
 lobes.coat=coat;lobes.coatRough=coatRough;lobes.coatN=coatN;
 let coatFloor=lobeRoughness(coatRough);lobes.coatAlpha=coatFloor*coatFloor;
 lobes.at=axis.w;lobes.ab=alpha;
 lobes.invAt=1.0/lobes.at;lobes.invAb=1.0/lobes.ab;lobes.dScale=1.0/(PI*lobes.at*lobes.ab);
 lobes.view=vec2f(lobes.at*dot(lobes.T,V),lobes.ab*dot(lobes.B,V));
 lobes.coatNoV=saturate(dot(coatN,V));
}
/** The base the pixel's coat is over, what the clear coat reads of it besides the surface the light loop is given: its
 *  colour and metalness, its roughness. Set after \`setLobes\`, where the pixel's colours are read. */
fn setLobeBase(rgb:vec3f,metal:f32,rough:f32){
 lobes.baseColour=rgb;lobes.metal=metal;lobes.baseRough=rough;
 // A metal's absorption along the coat's path (\`coatTransmittance\`), taken here once, not once a light.
 if(metal>0.0){lobes.extinction=-log(max(rgb*INVERSE_PI,vec3f(0.0001)))/2.0;}
}
/** The pixel is a cloth of fuzz colour \`fuzz\` and cloth amount \`cloth\`, seen along \`V\` on the normal \`N\` at the
 *  surface's roughness \`rough\`, after its lobes (\`setLobes\`, which leave it round and uncoated): the fuzz's view of the
 *  sheen table is taken here once (\`clothSheen\`). */
fn setCloth(fuzz:vec3f,cloth:f32,N:vec3f,V:vec3f,rough:f32){
 lobes.fuzz=fuzz;lobes.cloth=cloth;roughDiffuse=false;
 lobes.sheen=clothSheen(N,V,rough);
}
/** A stored cloth texel's lobes: round (width \`alpha\`) and uncoated, with the fields only a skewed or coated
 *  lobe reads (the frame's cross product, the reciprocals, the view in it, the coat's surface) left as
 *  they were; \`setLobes\` then \`setCloth\` would set the same fields the cloth reads. */
fn setClothLobes(fuzz:vec3f,cloth:f32,alpha:f32,N:vec3f,V:vec3f,rough:f32){
 lobes.on=true;
 lobes.cloth=cloth;lobes.fuzz=fuzz;roughDiffuse=false;
 lobes.sheen=clothSheen(N,V,rough);
 lobes.skewed=false;lobes.T=vec3f(0.0);lobes.at=alpha;
 lobes.coat=0.0;
}
/** A light's term \`lit\` of a pixel's standard lobe, diffuse and specular, under the cloth's fuzz: what the diffuse and the specular
 *  keep of their light (\`sheenKeep\`) plus the fuzz lobe's light \`fuzz\` (\`sheenFuzz\`). */
fn clothMix(lit:vec3f,fuzz:vec3f)->vec3f{return lit*sheenKeep(lobes.sheen,lobes.cloth)+fuzz;}
/** The cloth's surface for the lights: its reflectance masked by the cloth amount, as the cloth's legacy conversion does (the
 *  fuzz gradually replaces the specular lobe), and the reflectance at grazing angles that goes with it (\`slabF90\`). Any other
 *  pixel's surface as it is. */
fn clothSurface(s:LobeSurface)->LobeSurface{
 if(!hasCloth()){return s;}
 var c=s;
 c.f0=s.f0*(1.0-lobes.cloth);
 c.f90=slabF90(c.f0);
 return c;
}
/** What a cloth's base keeps of the light its fuzz lets through to its diffuse and its specular: \`sheenKeep\`, one for any other pixel. */
fn indirectKeep()->f32{
 if(!hasCloth()){return 1.0;}
 return sheenKeep(lobes.sheen,lobes.cloth);
}
/** The diffuse colour of a pixel's indirect light: its albedo, and for a cloth what the fuzz lets through of it plus the fuzz
 *  colour times the cloth amount and the fuzz's albedo, the metal then spent (\`.w\` the metalness the diffuse is taken with). */
fn clothDiffuse(rgb:vec3f,metal:f32)->vec4f{
 if(hasCloth()){return vec4f(rgb*(1.0-metal)*indirectKeep()+lobes.fuzz*(lobes.cloth*lobes.sheen.albedo),0.0);}
 if(hasCoat()){return vec4f(coatRemap(rgb,metal).diffuse,0.0);}
 return modelDiffuse(vec4f(rgb,metal));
}
/** The specular colour of a pixel's indirect light: the surface's reflectance, and under a coat what the coat's
 *  absorption and refraction leave of it (\`coatRemap\`). */
fn indirectF0(rgb:vec3f,metal:f32)->vec3f{
 if(hasCoat()){return coatRemap(rgb,metal).specular;}
 return surfaceF0(rgb,metal);
}
/** What the coat lets through of the base's reflections: one minus the coat's weight times the energy of its own
 *  dielectric lobe at its roughness and N·V (the energy terms every reflection weighs the coat by), one without a coat. */
fn coatLayerKeep()->f32{
 if(!hasCoat()){return 1.0;}
 return 1.0-lobes.coat*energyTerms(DIELECTRIC_F0,envBrdfF90(DIELECTRIC_F0),lobeRoughness(lobes.coatRough),clampNoV(lobes.coatNoV)).x;
}
/** The view's length in the stretched frame, finished once a pixel on its surface's N·V
 *  (\`lobeSurface\`), which the light loop hands it (\`sliceLighting\`): one N·V a pixel. */
fn lobeView(s:LobeSurface){if(lobes.on){lobes.viewLength=length(vec3f(lobes.view,s.NdotV));}}
/** The anisotropic lobe of one light past its direction \`L\`, half-vector \`H\` and \`NdotL\` above
 *  zero, on surface \`s\`, as \`standardLobe\` is the standard one's. */
fn anisotropicLobe(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 let direct=energy*NdotL;
 let T=lobes.T;let B=lobes.B;let at=lobes.at;let ab=lobes.ab;
 let h=vec3f(dot(T,H)*lobes.invAt,dot(B,H)*lobes.invAb,max(dot(N,H),0.0));
 let q=dot(h,h);
 let D=lobes.dScale/(q*q);
 let gV=NdotL*lobes.viewLength;
 let gL=s.NdotV*length(vec3f(at*dot(T,L),ab*dot(B,L),NdotL));
 let VdotH=max(dot(V,H),0.0);
 return lobeSum(s,lobeDiffuseH(s,NdotL,VdotH,1.0),D,gV,gL,VdotH,direct);
}
/** The hooks of the one \`surfaceLight\` and \`rectLightSplit\` (\`../standardLighting.ts\`,
 *  \`rectLightWgsl.ts\`) on a pixel whose lobes are set: the base's lobe, anisotropic where it is
 *  skewed, on the surface the lobes were set for; a pixel without lobes answers the standard lobe. A pixel
 *  with a coat never asks them (\`coatedPoint\`). */
fn baseLobe(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 if(hasSkew()){return anisotropicLobe(s,N,V,L,H,NdotL,energy);}
 let lit=standardLobe(s,N,V,H,NdotL,energy);
 if(hasCloth()){return clothMix(lit,sheenFuzz(lobes.sheen,N,L,lobes.fuzz,lobes.cloth,energy));}
 return lit;
}
/** The same hook for a lamp of size (\`lampLight\`, \`lampLobeWgsl.ts\`): the base lobe — a skewed one
 *  keeps its anisotropic distribution at the lamp's cosine and its highlight's direction, none of
 *  the sphere's widening. */
fn baseLampLobe(s:LobeSurface,N:vec3f,V:vec3f,look:Look,lamp:Lamp,energy:f32)->vec3f{
 if(lamp.cosine<=0.0){return vec3f(0.0);}
 if(hasSkew()){return anisotropicLobe(s,N,V,look.toward,normalize(look.toward+V),lamp.cosine,energy);}
 let h=lampHalf(s,N,V,look);
 let lit=lampLobeWith(h,s,V,look,lamp.cosine,lamp.lineCos,energy);
 if(hasCloth()){return clothMix(lit,sheenFuzz(lobes.sheen,N,lamp.toward,lobes.fuzz,lobes.cloth,energy));}
 return lit;
}`,
)

/** A lobed program's hooks of the one \`rectLightSplit\` (\`rectLightWgsl.ts\`), where the image holds a
 *  rectangle: the base's fitted lobe, its polygon and view stretched by the anisotropy (αt along \`T\`)
 *  as αt stretches the distribution — the view's stretch a pixel's, so its frame is the pixel's too
 *  (\`pixelRectFrame\`) —, and the coated base's (\`coatedRect\`), the coat's frame taken once
 *  a pixel too (\`coatRectFrame\`). */
export const LOBES_RECT_WGSL = wgslBlock(
  'LOBES_RECT_WGSL',
  [LOBES_LIGHTING_WGSL, RECT_SURFACE_LIGHT_WGSL, SHEEN_RECT_WGSL],
  `
fn rectBase(r:RectView,N:vec3f,V:vec3f,f0:vec3f,rough:f32)->vec3f{
 if(!hasSkew()){return rectLtc(r,pixelRectFrame(N,V,rough),f0);}
 let T=lobes.T;let k=lobes.ab/lobes.at-1.0;
 let s=RectView(r.a+k*T*dot(T,r.a),r.b+k*T*dot(T,r.b),r.c+k*T*dot(T,r.c),r.d+k*T*dot(T,r.d),r.window,r.slot);
 return rectLtc(s,pixelRectFrame(N,normalize(V+k*T*dot(T,V)),rough),f0);
}
var<private> coatFrameHeld:bool=false;
var<private> coatFrameKept:RectFrame;
fn coatRectFrame(V:vec3f)->RectFrame{
 if(!coatFrameHeld){coatFrameKept=rectFrameOf(lobes.coatN,V,lobes.coatRough);coatFrameHeld=true;}
 return coatFrameKept;
}
/** A rectangle's diffuse (column 0) and specular (column 1) light \`parts\`, before its colour, under a cloth's fuzz: what they keep of
 *  it (\`sheenKeep\`) and, in the specular's, the fuzz lobe's light of the rectangle (\`sheenRect\`) of the light's \`intensity\`, its
 *  range window and the cloth amount, times the rectangle's \`picture\` colour. A pixel that is no cloth keeps them. */
fn rectCloth(parts:mat2x3f,r:RectView,N:vec3f,intensity:f32,picture:vec3f)->mat2x3f{
 if(!hasCloth()){return parts;}
 let keep=sheenKeep(lobes.sheen,lobes.cloth);
 let fuzz=lobes.fuzz*(lobes.cloth*intensity*r.window*sheenRect(lobes.sheen,N,r))*picture;
 return mat2x3f(parts[0]*keep,parts[1]*keep+fuzz);
}
/** A rectangle's light on the base under the coat (\`coatedLight\`): its diffuse (column 0) and specular (column 1) of the
 *  rectangle's view \`r\`, its mean direction and irradiance \`incident\`, before its colour; the fitted lobe of the
 *  coat's normal and roughness on the top layer, the base's (\`rectBase\`) on the base. */
fn coatedRect(light:DirectLight,r:RectView,incident:vec4f,s:LobeSurface,N:vec3f,V:vec3f,rough:f32)->mat2x3f{
 let intensity=lightStrength(light);
 let form=rectFormOf(r)*r.window;
 let cosine=select(0.0,incident.w/form,form>0.0);
 let topLtc=rectLtc(r,coatRectFrame(V),DIELECTRIC_F0)*(intensity*r.window);
 let bottomLtc=rectBase(r,N,V,s.f0,rough)*(intensity*r.window);
 return coatedLight(s,N,V,incident.xyz,cosine,intensity*incident.w,0.0,0.0,1.0,true,topLtc,bottomLtc,0.0);
}`,
)

/** A lobeless program's hooks of the one \`surfaceLight\` (\`LOBES_LIGHTING_WGSL\`'s): no lobe is ever
 *  set, so the base is the standard lobe, with no coat — every term keeps its bits. What a program that lights a surface without
 *  a lobe lists: it brings \`surfaceLight\` (\`SURFACE_LIGHT_WGSL\`). */
const LOBELESS_HOOKS_WGSL = wgslBlock(
  'LOBELESS_HOOKS_WGSL',
  [SURFACE_LIGHT_WGSL, LAMP_SURFACE_LIGHT_WGSL],
  `fn hasCoat()->bool{return false;}
fn coatedPoint(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,energy:f32)->mat2x3f{return mat2x3f();}
fn coatedLamp(s:LobeSurface,N:vec3f,V:vec3f,look:Look,lamp:Lamp,energy:f32)->mat2x3f{return mat2x3f();}
fn coatLayerKeep()->f32{return 1.0;}
fn indirectF0(rgb:vec3f,metal:f32)->vec3f{return surfaceF0(rgb,metal);}
fn lobeView(s:LobeSurface){}
fn clothSurface(s:LobeSurface)->LobeSurface{return s;}
fn indirectKeep()->f32{return 1.0;}
fn baseLobe(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{return standardLobe(s,N,V,H,NdotL,energy);}
fn baseLampLobe(s:LobeSurface,N:vec3f,V:vec3f,look:Look,lamp:Lamp,energy:f32)->vec3f{
 if(lamp.cosine<=0.0){return vec3f(0.0);}
 return lampLobe(s,N,V,look,lamp.cosine,lamp.lineCos,energy);
}`,
)
export const LOBELESS_LIGHTING_WGSL = wgslBlock(
  'LOBELESS_LIGHTING_WGSL',
  [LOBELESS_HOOKS_WGSL],
  `fn clothDiffuse(rgb:vec3f,metal:f32)->vec4f{return vec4f(rgb,metal);}`,
)

/** The lobeless hooks of the programs that light pixels of the shading models a graph picks per
 *  pixel (`shadingModelWgsl.ts`): the same, but for the diffuse colour of the indirect light, which a
 *  model sets (`modelDiffuse`). */
export const LOBELESS_MODELS_LIGHTING_WGSL = wgslBlock(
  'LOBELESS_MODELS_LIGHTING_WGSL',
  [LOBELESS_HOOKS_WGSL, SHADING_MODEL_PIXEL_WGSL],
  `fn clothDiffuse(rgb:vec3f,metal:f32)->vec4f{return modelDiffuse(vec4f(rgb,metal));}`,
)

/** The same of the one \`rectLightSplit\` (\`rectLightWgsl.ts\`): the plain fitted lobe and no coat. */
export const LOBELESS_RECT_WGSL = wgslBlock(
  'LOBELESS_RECT_WGSL',
  [RECT_SURFACE_LIGHT_WGSL],
  `fn rectBase(r:RectView,N:vec3f,V:vec3f,f0:vec3f,rough:f32)->vec3f{return rectLtc(r,pixelRectFrame(N,V,rough),f0);}
fn rectCloth(parts:mat2x3f,r:RectView,N:vec3f,intensity:f32,picture:vec3f)->mat2x3f{return parts;}
fn coatedRect(light:DirectLight,r:RectView,incident:vec4f,s:LobeSurface,N:vec3f,V:vec3f,rough:f32)->mat2x3f{return mat2x3f();}`,
)

/** The decode of a texel of the lobes target into a pixel's lobes (`lobesAt`; a cloth's texel into a
 *  round lobe and its fuzz, `lobeIsCloth`), at its roughness
 *  `rough`, its coat normal turned by `side` (-1 where a reader turned the stored normal to face the
 *  eye): the one reading of the opaque lit passes and the opaque reflection
 *  (`../reflections/trace/trace.ts`). */
export const LOBES_DECODE_WGSL = wgslBlock(
  'LOBES_DECODE_WGSL',
  [LOBE_PACK_WGSL, LOBE_AXIS_WGSL],
  `
fn lobesAt(w:vec4u,side:f32,N:vec3f,V:vec3f,rough:f32){
 let alpha=lobeAlpha(rough);
 if(lobeIsCloth(w)){
  setClothLobes(packedFuzz(w),packedCloth(w),alpha,N,V,rough);
  return;
 }
 let coat=packedCoat(w);
 setLobes(packedLobeAxis(w,N,alpha),coat.x,coat.y,lobeOctDecode(w.y)*side,N,V,packedLobeAcross(w,alpha));
}`,
)

/** The read of a pixel's lobes from the lobes target, a read-only storage texture: no sampled
 *  texture of the sixteen a stage is guaranteed (`../deferred/layoutEntries.ts`). `readLobes`, the opaque
 *  resolve's, reads the pixel's texel as it is stored. */
export const LOBES_TARGET_WGSL = wgslBlock(
  'LOBES_TARGET_WGSL',
  [LOBES_DECODE_WGSL],
  `
${PHYSICAL_LOBES_TARGET.wgsl}
fn readLobes(coord:vec2i,N:vec3f,V:vec3f,rough:f32){lobesAt(textureLoad(physicalLobes,coord),1.0,N,V,rough);}`,
)

/** The surface reads its lobes where its flag says so (`LIT_PIXEL_WGSL`), at its roughness. */
export const readLobesStatement = (flag: number) =>
  `if((surfaceFlag&${flag}u)!=0u){readLobes(coord,N,V,normal.a);setLobeBase(base.rgb,base.a,normal.a);}`
