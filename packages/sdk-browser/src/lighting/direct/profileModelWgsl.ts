import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SUBSURFACE_OPACITY_THRESHOLD } from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
import {
  LIT_PROFILE_ROWS,
  LIT_TRANSMISSION_VEC4S,
} from '../../../../sdk-core/src/lighting/subsurfaceProfile/litRows.ts'
import { PROFILE_COLUMNS } from '../../../../sdk-core/src/lighting/subsurfaceProfile/table.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { MAX_DUAL_SPECULAR_ROUGHNESS } from '../../../../sdk-core/src/lighting/subsurfaceProfile/table.ts'
import { pow5 } from '../../../../math/src/wgsl/lighting.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LAMP_LOBE_WGSL } from './lampLobeWgsl.ts'
import { RECT_SURFACE_LIGHT_WGSL } from './rectLightWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from './shadingModelState.ts'

/**
 * THE LIGHT OF A PIXEL OF THE SUBSURFACE-PROFILE MODEL, from a lamp (`profileLampLight`): its two shares, the diffuse (column 0) and the
 * specular (column 1), before the light's colour and its shares.
 * - The diffuse is the Burley diffuse (`profileBurley`): the diffuse albedo times the retro-reflection of the view and the light, whose
 *   grazing term takes the surface's roughness and the half vector's cosine with the view.
 * - The specular is two GGX lobes of the profile (`profileLobesOf`, from the profile's row in the light buffer: the roughness of the surface
 *   scaled by the row's two scales, the scales fading to one as the opacity falls to the threshold under which the pixel is the plain
 *   model) mixed by the row's weight; each is widened by the lamp's size as the plain lobe is
 *   (`lobeEnergy`), the visibility is the one of their average roughness, the Fresnel the plain one's.
 * The luminance of the diffuse light is what the scattering spreads (`scatterAdd`). A rectangle's term is `PROFILE_RECT_WGSL`'s.
 */
export const PROFILE_LIGHT_WGSL = wgslBlock(
  'PROFILE_LIGHT_WGSL',
  [STANDARD_LIGHTING_WGSL, LAMP_LOBE_WGSL, SHADING_MODEL_STATE_WGSL, pow5],
  `
const PROFILE_ROWS:u32=${LIT_PROFILE_ROWS}u;
/** The roughness of the profile's two lobes at the surface roughness \`rough\` and the opacity, from its row's dual specular
 *  texel \`row\`: \`x\` the first lobe's, \`y\` the second's, \`z\` their mix. */
fn profileDualSpecular(row:vec4f,rough:f32,opacity:f32)->vec3f{
 let fade=saturate((opacity-${wgslF32(SUBSURFACE_OPACITY_THRESHOLD)})*10.0);
 let scale0=mix(1.0,row.x*${wgslF32(MAX_DUAL_SPECULAR_ROUGHNESS)},fade);
 let scale1=mix(1.0,row.y*${wgslF32(MAX_DUAL_SPECULAR_ROUGHNESS)},fade);
 return vec3f(max(saturate(rough*scale0),0.02),saturate(rough*scale1),row.z);
}
var<private> profileLobesHeld:bool=false;
var<private> profileLobesKept:vec3f;
/** The pixel's two lobes, taken once: every light of the pixel reads the same profile. */
fn profileLobesOf(rough:f32)->vec3f{
 if(!profileLobesHeld){
  profileLobesKept=profileDualSpecular(directLights.profiles[min(modelProfile,PROFILE_ROWS-1u)],rough,modelOpacity);
  profileLobesHeld=true;
 }
 return profileLobesKept;
}
/** The surface with its N·V held as the profile's terms hold it, off the horizon from either side. */
fn profileView(s:LobeSurface,N:vec3f,V:vec3f)->LobeSurface{
 var t=s;
 t.NdotV=saturate(abs(dot(N,V))+1e-5);
 t.viewG=jointHalf(t.NdotV,t.alpha);
 return t;
}
fn profileBurley(s:LobeSurface,rough:f32,NoL:f32,VoH:f32)->vec3f{
 let fd90=0.5+2.0*VoH*VoH*rough;
 return s.diffuse*((1.0+(fd90-1.0)*pow5(1.0-s.NdotV))*(1.0+(fd90-1.0)*pow5(1.0-NoL)));
}
/** The two lobes' specular at the half vector \`h\` (\`lampHalf\`) of a lamp's \`look\`. */
fn profileSpecular(s:LobeSurface,lobes:vec3f,h:vec3f,look:Look,cosine:f32,lineCos:f32,energy:f32)->vec3f{
 let NoH=h.x;let VoH=h.y;let sine=h.z;
 let average=mix(lobes.x,lobes.y,lobes.z);
 let alpha=average*average;
 let a0=lobes.x*lobes.x;let a1=lobes.y*lobes.y;
 let wide0=lobeEnergy(a0*a0,VoH,sine,saturate(look.soft),lineCos);
 let wide1=lobeEnergy(a1*a1,VoH,sine,saturate(look.soft),lineCos);
 let sine2=max(1.0-NoH*NoH,0.0);
 let D=mix(ggxDistribution(wide0.x,NoH,sine2)*wide0.y,ggxDistribution(wide1.x,NoH,sine2)*wide1.y,lobes.z);
 var t=s;
 t.diffuse=vec3f(0.0);
 t.alpha=alpha;t.alpha2=alpha*alpha;t.viewG=jointHalf(s.NdotV,alpha);
 return lobeSum(t,D,cosine*t.viewG,s.NdotV*jointHalf(cosine,alpha),VoH,energy*cosine);
}
/** A lamp's diffuse (column 0) and specular (column 1) on the surface \`s\` of roughness \`rough\`. */
fn profileLampLight(s:LobeSurface,N:vec3f,V:vec3f,light:DirectLight,P:vec3f,lamp:Lamp,energy:f32,rough:f32)->mat2x3f{
 if(lamp.cosine<=0.0){return mat2x3f();}
 var look=Look(lamp.toward,0.0,0.0);
 if(lamp.capsule){look=capsuleLook(light.positionRange.xyz-P,light.capsule.xyz,light.shape.x,light.capsule.w,N,V);}
 let t=profileView(s,N,V);
 let h=lampHalf(t,N,V,look);
 return mat2x3f(profileBurley(t,rough,lamp.cosine,h.y)*(energy*lamp.cosine),profileSpecular(t,profileLobesOf(rough),h,look,lamp.cosine,lamp.lineCos,energy));
}`,
)

/** The optical depth, in centimetres, the transmission profile reaches: a shadow of nothing is a depth of nothing, a total shadow this one. */
const MAX_TRANSMISSION_DEPTH = 5

/**
 * A SUBSURFACE-PROFILE PIXEL'S TRANSMISSION of a light that transmits (`profileTransmission`, before the light's energy): the light that
 * crosses the thickness behind the lit side. The optical depth is the light's shadow read as a depth: `(1 − shade) · 5` cm, a shadow of
 * the maps carrying no distance of its own for a profile (its encoded optical thickness is the shadow itself); the profile's colour at that
 * depth (`profileTransmissionColour`, its `PROFILE_COLUMNS.transmissionProfileSize` samples over the depth, blended by the two
 * nearest, the edges held) times the Henyey-Greenstein phase of the profile's scattering distribution at the cosine of the light's
 * opposite with the view refracted into the surface by the profile's inverse index of refraction. The light's shadow weighs the term as the energy does.
 */
export const PROFILE_TRANSMISSION_WGSL = wgslBlock(
  'PROFILE_TRANSMISSION_WGSL',
  [SHADING_MODEL_STATE_WGSL],
  `
fn profileTransmissionColour(row:u32,depth:f32)->vec3f{
 let at=clamp(depth/${wgslF32(MAX_TRANSMISSION_DEPTH)}*${PROFILE_COLUMNS.transmissionProfileSize - 1}.0,0.0,${PROFILE_COLUMNS.transmissionProfileSize - 1}.0);
 let below=floor(at);
 let first=row*${LIT_TRANSMISSION_VEC4S}u+1u+u32(below);
 return mix(directLights.transmissions[first].rgb,directLights.transmissions[min(first+1u,row*${LIT_TRANSMISSION_VEC4S}u+${PROFILE_COLUMNS.transmissionProfileSize}u)].rgb,at-below);
}
fn profileHenyeyGreenstein(cosine:f32,g:f32)->f32{
 let wide=1.0-g*cosine;
 return 0.5*(1.0-g*g)/max(1e-5,wide*wide);
}
fn profileTransmission(N:vec3f,V:vec3f,L:vec3f,shade:f32)->vec3f{
 let row=min(modelProfile,${LIT_PROFILE_ROWS}u-1u);
 let params=directLights.transmissions[row*${LIT_TRANSMISSION_VEC4S}u];
 let colour=profileTransmissionColour(row,(1.0-shade)*${wgslF32(MAX_TRANSMISSION_DEPTH)});
 let refracted=refract(V,-N,params.w);
 return colour*profileHenyeyGreenstein(dot(-L,refracted),params.z*2.0-1.0);
}`,
)

/** A rectangle's term for the profile (`profileRectLight`), where the program holds rectangle lights: the Burley diffuse at the rectangle's
 *  mean direction on its irradiance, and the specular of the fitted lobe at each of the profile's two roughnesses, mixed by its weight
 *  (their frames taken once a pixel), all times the light's colour. */
export const PROFILE_RECT_WGSL = wgslBlock(
  'PROFILE_RECT_WGSL',
  [PROFILE_LIGHT_WGSL, RECT_SURFACE_LIGHT_WGSL],
  `
var<private> profileFramesHeld:bool=false;
var<private> profileFrame0:RectFrame;
var<private> profileFrame1:RectFrame;
fn profileRectLight(light:DirectLight,r:RectView,s:LobeSurface,N:vec3f,V:vec3f,rough:f32)->mat2x3f{
 let incident=rectIrradianceOf(r,N);
 if(incident.w<=0.0){return mat2x3f();}
 let lobes=profileLobesOf(rough);
 if(!profileFramesHeld){
  profileFrame0=rectFrameOf(N,V,lobes.x);
  profileFrame1=rectFrameOf(N,V,lobes.y);
  profileFramesHeld=true;
 }
 let tint=light.colorIntensity.rgb;
 let intensity=light.colorIntensity.w;
 let form=rectFormOf(r)*r.window;
 let cosine=select(0.0,incident.w/form,form>0.0);
 let VoL=dot(V,incident.xyz);
 let invLenH=inverseSqrt(2.0+2.0*VoL);
 let VoH=saturate(invLenH+invLenH*VoL);
 let diffuse=profileBurley(profileView(s,N,V),rough,cosine,VoH)*(intensity*incident.w)*tint;
 let specular=mix(rectLtc(r,profileFrame0,s.f0),rectLtc(r,profileFrame1,s.f0),lobes.z)*(intensity*r.window)*tint;
 return mat2x3f(diffuse,specular);
}`,
)
