import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { INVERSE_PI, PI } from '../../../../math/src/wgsl/constants.ts'
import { luminance, srgbToLinear } from '../../../../math/src/wgsl/color.ts'
import { pow5 } from '../../../../math/src/wgsl/lighting.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { SKIN_TABLE_SIZE } from '../../../../sdk-core/src/lighting/skinTable.ts'
import { PIXEL_MODEL, quantise8, quantise8x2 } from '../../materials/surface/pixelModel.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LAMP_LOBE_WGSL } from './lampLobeWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from './shadingModelState.ts'
import { PROFILE_TRANSMISSION_WGSL } from './profileModelWgsl.ts'
import { SUBSURFACE_BXDF_WGSL } from './subsurfaceBxdfWgsl.ts'
import { SHADOW_TERMS_WGSL } from './shadowTermsWgsl.ts'

/**
 * THE SHADING MODELS A GRAPH PICKS PER PIXEL (`../../materials/surface/pixelModel.ts`): the
 * preintegrated skin, the subsurface profile, the hair and the eye, as the lighting holds them. A pixel of one reads its model
 * and what the model needs once (`setPixelModel`, from its surface flags and the thin transmission's
 * target) and sets the state below, which the light term and the indirect light then read; a pixel of
 * none leaves it zero, and a program that never sets it runs every term as it was.
 *
 * Each model gives a light a term of its own, added to the light's term as a thin surface's
 * transmission is (`transmitted`, `lightLoopWgsl.ts`), `energy` times the colour of the light
 * multiplying it: the light's intensity through its falloff and its shadow.
 * - The thin subsurface: the physical model's lobes, and a term (`subsurfaceTransmission`, `subsurfaceBxdfWgsl.ts`) of the light from any side; its
 *   indirect diffuse colour is its base colour and its subsurface colour added, as the skin's.
 * - The skin: the diffuse and specular lobes of the physical model, and the light's cosine mapped to
 *   [0, 1] (`N·L / 2 + 1 / 2`) and one minus the surface's opacity read, as the two coordinates, in the
 *   preintegrated table (`skinTableWgsl`), times the subsurface colour: the light that goes through the
 *   skin's thickness. Its indirect diffuse colour is its base colour and its subsurface colour added.
 * - The subsurface profile: the physical model's Burley diffuse and a specular of two lobes, the profile's (`profileModelWgsl.ts`);
 *   its diffuse light is the one the screen-space scattering spreads (`../subsurface/litHook.ts`).
 * - The hair: no diffuse or specular lobe; the light is `hairShading`, the three components of the fibre
 *   (the reflection R, the transmission TT, the internal reflection TRT) of a Gaussian lobe each along the
 *   fibre — the normal is the fibre's direction, pointing to its root —, and a multiple scattering
 *   approximation, its scatter amount the metalness the pixel stored (`modelScatter`). Its indirect diffuse colour is the
 *   hair's response to the light from the direction its fibre is seen along (`hairEnvironment`), and it reflects nothing.
 * - The eye: the physical model's specular lobe on a dielectric whose grazing reflectance is one, and in
 *   place of its diffuse lobe a term that lights the sclera by the light's cosine and the iris by the
 *   cosine of the iris normal with a caustic (`eyeTransmission`), mixed by the iris mask, under what the
 *   specular lobe reflects.
 */
const { subsurface, skin, profile, hair, eye } = PIXEL_MODEL

/** The preintegrated table, read as a texture of `SKIN_TABLE_SIZE` texels a side is: its colours in
 *  sRGB, decoded at each texel before the bilinear blend, the coordinates clamped to the edge. */
const SKIN_TABLE_WGSL = wgslBlock(
  'SKIN_TABLE_WGSL',
  [srgbToLinear],
  `
fn skinTexel(x:i32,y:i32)->vec3f{
 let at=u32(clamp(y,0,${SKIN_TABLE_SIZE - 1}))*${SKIN_TABLE_SIZE}u+u32(clamp(x,0,${SKIN_TABLE_SIZE - 1}));
 let word=directLights.skin[at];
 return srgbToLinear(vec3f(f32(word&255u),f32((word>>8u)&255u),f32((word>>16u)&255u))/255.0);
}
fn skinTableAt(uv:vec2f)->vec3f{
 let p=uv*${SKIN_TABLE_SIZE}.0-0.5;
 let f=floor(p);
 let t=p-f;
 let x=i32(f.x);let y=i32(f.y);
 return mix(mix(skinTexel(x,y),skinTexel(x+1,y),t.x),mix(skinTexel(x,y+1),skinTexel(x+1,y+1),t.x),t.y);
}`,
)

/** The skin's term of a light toward `L`: the table read at the cosine and the opacity, times the
 *  subsurface colour. */
const SKIN_WGSL = wgslBlock(
  'SKIN_WGSL',
  [SHADING_MODEL_STATE_WGSL, SKIN_TABLE_WGSL],
  `
fn skinTransmission(N:vec3f,L:vec3f)->vec3f{
 return skinTableAt(vec2f(saturate(dot(N,L)*0.5+0.5),1.0-modelOpacity))*modelColour;
}`,
)

/**
 * The hair's BSDF: a Gaussian lobe along the fibre for each of its components, as the fibre's
 * reflection (R), transmission (TT) and internal reflection (TRT), summed under a multiple
 * scattering approximation. `N` is the fibre's direction, `L` and `V` the unit directions toward the
 * light and the eye, `shade` the light's visibility, `backlit` how much light the fibre lets through from
 * behind (the TT term, the R term in the half turn behind it) and `area` the width a source of size adds
 * to the lobes. The scatter amount (`modelScatter`) weighs the diffuse approximation of the multiple scattering.
 */
const HAIR_WGSL = wgslBlock(
  'HAIR_WGSL',
  [SHADING_MODEL_STATE_WGSL, SURFACE_F0_WGSL, PI, INVERSE_PI, luminance, pow5],
  `
fn hairG(B:f32,theta:f32)->f32{return exp(-0.5*theta*theta/(B*B))/(sqrt(2.0*PI)*max(B,0.01));}
fn hairF(cosine:f32)->f32{
 let n=1.55;
 let f0=((1.0-n)/(1.0+n))*((1.0-n)/(1.0+n));
 return f0+(1.0-f0)*pow5(1.0-cosine);
}
fn acosFast(x:f32)->f32{
 let a=abs(x);
 let r=(-0.156583*a+0.5*PI)*sqrt(1.0-a);
 return select(PI-r,r,x>=0.0);
}
fn asinFast(x:f32)->f32{return 0.5*PI-acosFast(x);}
/** The soft Kajiya-Kay diffuse of the multiple scattering: the fibre seen as the normal turned to the eye, the
 *  scatter amount, and the base colour's tint where the light is shadowed. */
fn hairDiffuse(base:vec3f,N:vec3f,V:vec3f,L:vec3f,shade:f32)->vec3f{
 let kajiya=1.0-abs(dot(N,L));
 let fake=normalize(V-N*dot(V,N));
 let wrapped=saturate((dot(fake,L)+1.0)/4.0);
 let scatter=INVERSE_PI*mix(wrapped,kajiya,0.33)*modelScatter;
 let baseOverLuma=abs(base/max(luminance(base),0.0001));
 let tint=select(vec3f(1.0),pow(baseOverLuma,vec3f(1.0-shade)),shade<1.0);
 return sqrt(abs(base))*scatter*tint;
}
fn hairShading(base:vec3f,rough:f32,N:vec3f,V:vec3f,L:vec3f,shade:f32,visible:f32,backlit:f32,area:f32)->vec3f{
 let r=clamp(rough,1.0/255.0,1.0);
 let VoL=dot(V,L);
 let sinL=clamp(dot(N,L),-1.0,1.0);
 let sinV=clamp(dot(N,V),-1.0,1.0);
 let cosD=cos(0.5*abs(asinFast(sinV)-asinFast(sinL)));
 let Lp=L-sinL*N;
 let Vp=V-sinV*N;
 let cosPhi=dot(Lp,Vp)*inverseSqrt(dot(Lp,Lp)*dot(Vp,Vp)+1e-4);
 let cosHalf=sqrt(saturate(0.5+0.5*cosPhi));
 let nPrime=1.19/cosD+0.36*cosD;
 let shift=0.035;
 let alpha=vec3f(-shift*2.0,shift,shift*4.0);
 let B=vec3f(area+r*r,area+r*r/2.0,area+r*r*2.0);
 var S=vec3f(0.0);
 // R
 let sa=sin(alpha.x);let ca=cos(alpha.x);
 let shiftR=2.0*sa*(ca*cosHalf*sqrt(1.0-sinV*sinV)+sa*sinV);
 let mR=hairG(B.x*sqrt(2.0)*cosHalf,sinL+sinV-shiftR);
 S+=vec3f(mR*0.25*cosHalf*hairF(sqrt(saturate(0.5+0.5*VoL)))*(surfaceSpecular*2.0)*mix(1.0,backlit,saturate(-VoL)));
 // TT
 let mTT=hairG(B.y,sinL+sinV-alpha.y);
 let a=1.0/nPrime;
 let h=cosHalf*(1.0+a*(0.6-0.8*cosPhi));
 let f=hairF(cosD*sqrt(saturate(1.0-h*h)));
 let tt=pow(abs(base),vec3f(0.5*sqrt(1.0-(h*a)*(h*a))/cosD));
 S+=mTT*exp(-3.65*cosPhi-3.98)*(1.0-f)*(1.0-f)*tt*backlit;
 // TRT
 let mTRT=hairG(B.z,sinL+sinV-alpha.z);
 let f2=hairF(cosD*0.5);
 let trt=pow(abs(base),vec3f(0.8/cosD));
 S+=mTRT*exp(17.0*cosPhi-16.78)*(1.0-f2)*(1.0-f2)*f2*trt;
 // The multiple scattering: the global scattering is one, the local none.
 S=S*visible+hairDiffuse(base,N,V,L,shade);
 return max(S,vec3f(0.0));
}
/** What the hair gives its diffuse light: its response to the light from the direction the fibre is seen
 *  along, weighed by the whole sphere's solid angle and held to one — no energy is added. */
fn hairEnvironment(base:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 let L=normalize(V-N*dot(V,N));
 return min(vec3f(1.0),2.0*PI*hairShading(base,rough,N,V,L,1.0,1.0,0.0,0.2));
}`,
)

/** The eye's term of a light whose specular direction is \`L\` (the nearest point of a tube to the reflection,
 *  \`lampHalf\`'s own), its cosine with the normal \`cosine\` and its sphere's sine \`sine\`: the sclera by that
 *  cosine, the iris by the cosine of the iris normal with a caustic whose lobe narrows as the light comes round
 *  to the iris's axis, the caustic normal bent toward the opposite of the normal by the iris mask times its
 *  distance; mixed by the iris mask, under what the specular lobe reflects — the Fresnel at the half vector
 *  the sphere moves, without a Newton step, the specular's reflectance a dielectric's — and over the base
 *  colour's Lambert diffuse. A rectangle light has the view's cosine for the half vector's. */
const EYE_WGSL = wgslBlock(
  'EYE_WGSL',
  [SHADING_MODEL_STATE_WGSL, SURFACE_F0_WGSL, INVERSE_PI, LAMP_LOBE_WGSL, pow5],
  `
fn eyeTransmission(rgb:vec3f,N:vec3f,V:vec3f,L:vec3f,cosine:f32,sine:f32,rect:bool)->vec3f{
 let irisNoL=saturate(dot(irisNormal,L));
 let power=mix(12.0,1.0,irisNoL);
  let caustic=0.8+0.2*(power+1.0)*pow(saturate(dot(irisCaustic,L)),power);
 let iris=irisNoL*caustic;
 let NoL=dot(N,L);let NoV=dot(N,V);let VoL=dot(V,L);
 let invLenH=inverseSqrt(2.0+2.0*VoL);
 var VoH=saturate(invLenH+invLenH*VoL);
 if(sine>0.0){VoH=sphereHalfCosines(NoL,NoV,VoL,sine).y;}
 if(rect){VoH=saturate(abs(NoV)+1e-5);}
 let fc=pow5(1.0-VoH);
 let F=fc+(1.0-fc)*(surfaceSpecular*0.08);
 return rgb*INVERSE_PI*(mix(cosine,iris,irisMask)*(1.0-F));
}`,
)

/**
 * What a pixel's model is set from and gives the indirect light, in the lit passes that read the pixel
 * (`litPixelStatements`) and in every program that lists the lobes' hooks (`LOBES_LIGHTING_WGSL`).
 * - `setPixelModel`: the pixel's model number `model`, its `data` (the thin transmission's texel), its
 *   base colour and metalness `base`, its normal, the direction to the eye and its roughness, and whether
 *   an eye's iris has a normal of its own (`irisDelta`), once a pixel; it gives back the base the pixel is lit with: the metalness a hair and an eye store
 *   (a scatter amount, an iris distance) is not a metal's.
 * - `modelDiffuse`: the diffuse colour of the indirect light of a pixel whose plain one is `d` (a colour and
 *   a metalness): a skin adds its subsurface colour, a hair is its response to the environment.
 */
export const SHADING_MODEL_PIXEL_WGSL = wgslBlock(
  'SHADING_MODEL_PIXEL_WGSL',
  [HAIR_WGSL, SUBSURFACE_BXDF_WGSL, octDecode, octEncode, SURFACE_F0_WGSL, quantise8x2, quantise8],
  `
fn modelIsSkinLike(model:u32)->bool{return model==${skin}u||model==${subsurface}u;}
fn setPixelModel(model:u32,data:vec4f,base:vec4f,N:vec3f,V:vec3f,rough:f32,irisDelta:bool)->vec4f{
 pixelModel=model;
 var lit=base;
 if(modelIsSkinLike(model)){
  modelColour=data.rgb;
  modelOpacity=data.a;
 }
 if(model==${subsurface}u){modelTransmitted=subsurfaceTransmittedColour(modelColour);}
 if(model==${profile}u){
  modelProfile=u32(max(round(data.x),0.0));
  modelOpacity=data.w;
 }
 if(model==${hair}u){
  modelScatter=base.a;
  lit.a=0.0;
  modelEnvironment=hairEnvironment(base.rgb,rough,N,V);
 }
 if(model==${eye}u){
  irisMask=1.0-quantise8(data.w);
  sphereNoNewton=true;
  if(irisDelta){
   // The iris normal and the caustic normal as differences from the surface's, in octahedral coordinates, 8 bits each; the
   // caustic's second travelled in the specular, which the lobe holds at its own value.
   let oct=octEncode(N);
   irisNormal=octDecode(oct+quantise8x2(data.yz)*2.0-256.0/255.0);
   irisCaustic=octDecode(oct+vec2f(quantise8(base.a),surfaceSpecular)*2.0-256.0/255.0);
   surfaceSpecular=0.25;
  }else{
   irisNormal=octDecode(quantise8x2(data.yz)*2.0-1.0);
   irisCaustic=normalize(mix(irisNormal,-N,irisMask*quantise8(base.a)));
  }
  lit.a=0.0;
 }
 return lit;
}
fn modelDiffuse(d:vec4f)->vec4f{
 if(modelIsSkinLike(pixelModel)){return vec4f(d.rgb*(1.0-d.w)+modelColour,0.0);}
 if(pixelModel==${hair}u){return vec4f(modelEnvironment,0.0);}
 return d;
}`,
)

/**
 * What the light terms read of a pixel's model.
 * - `modelTransmission`: a light's term of the pixel's model (zero for none) toward `L`, `specular` the
 *   direction of its highlight and `sine` its sphere's, `cosine` the light's cosine with the normal, `terms` the
 *   light's shadow terms (`shadowTermsOf`: a subsurface and a profile read the thickness, a hair's tint
 *   the transmission shadow and its multiple scattering the surface shadow), `rect` whether it is a
 *   rectangle and `transmits` whether the light shines through the subsurface profiles (a profile's
 *   term is that transmission alone) and `ao` the material's occlusion, before the light's energy.
 * - `modelLobeSurface`: the eye's surface for the light's specular lobe: no diffuse share (its own term holds it),
 *   and a grazing reflectance of one.
 */
export const SHADING_MODEL_LIGHT_WGSL = wgslBlock(
  'SHADING_MODEL_LIGHT_WGSL',
  [
    SHADING_MODEL_PIXEL_WGSL,
    SKIN_WGSL,
    EYE_WGSL,
    PROFILE_TRANSMISSION_WGSL,
    SUBSURFACE_BXDF_WGSL,
    STANDARD_LIGHTING_WGSL,
    SHADOW_TERMS_WGSL,
  ],
  `
fn modelTransmission(rgb:vec3f,rough:f32,N:vec3f,V:vec3f,L:vec3f,specular:vec3f,cosine:f32,sine:f32,terms:ShadowTerms,rect:bool,transmits:bool,ao:f32)->vec3f{
 if(pixelModel==${subsurface}u){return subsurfaceTransmission(N,V,L,ao,terms.thickness);}
 if(pixelModel==${skin}u){return skinTransmission(N,L);}
 if(pixelModel==${profile}u){return select(vec3f(0.0),profileTransmission(N,V,L,terms.thickness),transmits);}
 if(pixelModel==${hair}u){return hairShading(rgb,rough,N,V,L,terms.transmission,terms.surface,1.0,0.0);}
 if(pixelModel==${eye}u){return eyeTransmission(rgb,N,V,specular,cosine,sine,rect);}
 return vec3f(0.0);
}
fn modelLobeSurface(s:LobeSurface)->LobeSurface{
 var t=s;
 if(pixelModel==${eye}u){
  t.diffuse=vec3f(0.0);
  t.f90=1.0;
 }
 return t;
}`,
)
