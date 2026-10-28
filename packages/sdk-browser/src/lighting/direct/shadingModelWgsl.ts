import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { INVERSE_PI, PI } from '../../../../math/src/wgsl/constants.ts'
import { srgbToLinear } from '../../../../math/src/wgsl/color.ts'
import { clampNoV, pow5 } from '../../../../math/src/wgsl/lighting.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { HAIR_BSDF_WGSL } from '../../hair/hairBsdfWgsl.ts'
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
 * - The hair: no diffuse or specular lobe; the light is `hairLight`, the three components of the fibre
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

/** The transmittance of the strands toward light \`rank\` along \`L\`: none of a mask by default — the global scattering one, the local none —;
 *  a pass that holds a transmittance mask per light declares its own, which replaces this one (\`weak\`). */
const hairTransmittanceFor = wgslFn(
  'hairTransmittanceFor',
  [HAIR_BSDF_WGSL],
  'fn hairTransmittanceFor(rank:u32,L:vec3f)->HairTransmittanceData{return hairTransmittanceInit(true,true);}',
  { weak: true },
)

/**
 * The hair's light: the hair BSDF of the strands (`HAIR_BSDF_WGSL`, `../../hair/hairBsdfWgsl.ts`) under a transmittance of no mask — the global
 * scattering one, the local none, the opaque visibility the light's `visible` — and the scatter amount (`modelScatter`) as its metallic.
 * `N` is the fibre's direction, `L` and `V` the unit directions toward the light and the eye, `shade` the light's visibility, `backlit` how
 * much light the fibre lets through from behind and `area` the width a source of size adds to the lobes.
 */
const HAIR_WGSL = wgslBlock(
  'HAIR_WGSL',
  [SHADING_MODEL_STATE_WGSL, SURFACE_F0_WGSL, HAIR_BSDF_WGSL, hairTransmittanceFor, PI],
  `
/** The rank of the light in hand: set by the light's term before it asks its model (\`hairTransmittanceFor\`). */
var<private> hairLightRank:u32=0u;
fn hairLight(base:vec3f,rough:f32,N:vec3f,V:vec3f,L:vec3f,shade:f32,visible:f32,backlit:f32,area:f32)->vec3f{
 var td=hairTransmittanceFor(hairLightRank,L);
 td.opaqueVisibility=visible;
 return hairShading(base,rough,surfaceSpecular,modelScatter,1.0,L,V,N,shade,td,backlit,area);
}
/** What the hair gives its diffuse light: its response to the light from the direction the fibre is seen
 *  along, weighed by the whole sphere's solid angle and held to one — no energy is added. */
fn hairEnvironment(base:vec3f,rough:f32,N:vec3f,V:vec3f)->vec3f{
 let L=normalize(V-N*dot(V,N));
 return min(vec3f(1.0),2.0*PI*hairLight(base,rough,N,V,L,1.0,1.0,0.0,0.2));
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
  [SHADING_MODEL_STATE_WGSL, SURFACE_F0_WGSL, INVERSE_PI, LAMP_LOBE_WGSL, pow5, clampNoV],
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
 if(rect){VoH=clampNoV(NoV);}
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
 // A mesh's hair lights with an opaque visibility of 1 (the reference's default transmittance data): the surface shadow
 // weighs no part of it; the tint and the soft diffuse keep the transmission shadow.
 if(pixelModel==${hair}u){return hairLight(rgb,rough,N,V,L,terms.transmission,1.0,1.0,0.0);}
 if(pixelModel==${eye}u){return eyeTransmission(rgb,N,V,specular,cosine,sine,rect);}
 return vec3f(0.0);
}
fn modelLobeSurface(s:LobeSurface)->LobeSurface{
 if(pixelModel!=${eye}u){return s;}
 var t=withoutDiffuse(s);
 t.f90=1.0;
 return t;
}`,
)
