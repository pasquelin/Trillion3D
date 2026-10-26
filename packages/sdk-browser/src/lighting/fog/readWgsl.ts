import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import {
  logSliceOfDepth,
  ndcToUv,
  perspectiveDivide,
  uvToNdc,
} from '../../../../math/src/wgsl/projection.ts'
import { rand3dPcg16 } from '../../../../math/src/wgsl/sampling.ts'
import { FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { fogWgsl } from '../fogShader.ts'
import { hazeSampledWgsl } from '../atmosphere/hazeReadWgsl.ts'
import { view } from '../fogBlockAccess.ts'
import { SKY_CUBE_WGSL } from '../../modules/sky/skyLight/cubeWgsl.ts'
import { FOG_VOLUME_FRAME_WGSL } from './frame.ts'
import { fogTilesWgsl } from './localWgsl.ts'
import { FOG_VIEW_SLOT } from './viewSlots.ts'

/** The structure of the frame, written once for every program that reads it. */
export const FOG_FRAME_STRUCT_WGSL = wgslBlock('FOG_FRAME_STRUCT_WGSL', [], FOG_VOLUME_FRAME_WGSL)

/** Where a program binds what the fog reads past the light buffer, in the bind group `group`: the
 *  cubemap, the volume, and the sampler both are read through, and the lists of the local fog volumes
 *  over each tile. A binding left out answers as no cubemap or no volume would, and the view's own
 *  list of local fog volumes for no tiles (`fogResourcesWgsl`). The volume's view — where a surface finds its
 *  cell — is not a binding: it lies in the light buffer (`viewSlots.ts`). `translucent` reads the
 *  volume as a translucent layer does: through the sampler alone, the cubic filters left out, at
 *  where the point lies in the view; the passes that draw the whole image read it at the pixel,
 *  jittered where the settings ask, through the filter the settings name. */
export interface FogResourceBindings {
  readonly group: number
  readonly cubemap?: number
  readonly volume?: number
  readonly sampler?: number
  readonly translucent?: boolean
  /** The light shafts' occlusion mask, a filterable `texture_2d<f32>` read through the sampler
   *  (`lightShaftMask`); left out, the mask answers 1, no occlusion. */
  readonly lightShaft?: number
  /** The lists of the local fog volumes over each tile of the view, a read-only storage buffer of words
   *  (`localFogTileWord`, `localWgsl.ts`); left out, the program walks every volume of the view. */
  readonly tiles?: number
  /** Whether the program holds the local fog volumes' code (the project switch `localFogVolumeSupport`):
   *  true unless it says false, which leaves them out of its text and `tiles` unread. */
  readonly localFog?: boolean
  /** The 3D texture the volume of the haze is sampled from, read through `sampler` (`hazeSampledWgsl`,
   *  `../atmosphere/hazeReadWgsl.ts`); left out, the haze is read by hand from the light buffer's region
   *  (`HAZE_READ_WGSL`). */
  readonly haze?: number
}

/** The bindings as a block name reads them, in their declared order. */
export const fogBindingsLabel = (b: FogResourceBindings) =>
  `${b.group}, ${b.cubemap}, ${b.volume}, ${b.sampler}${b.translucent ? ', translucent' : ''}${b.lightShaft === undefined ? '' : `, ${b.lightShaft}`}${b.tiles === undefined ? '' : `, tiles ${b.tiles}`}${b.localFog === false ? ', no local fog volumes' : ''}${b.haze === undefined ? '' : `, haze ${b.haze}`}`

/** The view-projection the volume was built with, from the first four slots. */
const viewProjection = () =>
  `mat4x4f(${[0, 1, 2, 3].map((k) => view(FOG_VIEW_SLOT.projection + k)).join(',')})`

const reach = `directLights.fog[${FOG_SLOT.reach}]`

/** The cubemap's read: its colour along a direction, at its sharpest (level 0) and at its smallest
 *  (the last level, one texel a face), through the sampler — trilinear, seamless across the faces'
 *  edges. The level asked for the smallest is the cubemap's count of levels, past the last, which
 *  the sampler holds to it. While the sky light lights the height fog the binding holds the sky
 *  light's filtered cube in the place of the fog's (`fogReadOf`): the view block carries the strength
 *  the fog mixes it in by, the roughness and the count of mips it is read at (`FOG_VIEW_SLOT.heightFog`)
 *  and the light's colour (`skyLightColour`), and `fogSkyLightColour` reads it along a direction of the
 *  scene, turned into the cube's frame, at the mip of the roughness. */
const cubemapText = (b: Required<Pick<FogResourceBindings, 'group' | 'cubemap'>>) => `
@group(${b.group}) @binding(${b.cubemap}) var fogCubemap:texture_cube<f32>;
fn fogCubeSharp(direction:vec3f)->vec3f{return textureSampleLevel(fogCubemap,fogSampler,direction,0.0).rgb;}
fn fogCubeAverage(direction:vec3f)->vec3f{return textureSampleLevel(fogCubemap,fogSampler,direction,directLights.fog[${FOG_SLOT.cubemap}].z).rgb;}
fn fogSkyLightStrength()->f32{return ${view(FOG_VIEW_SLOT.heightFog)}.y;}
fn fogSkyLightColour(direction:vec3f)->vec3f{
 let read=${view(FOG_VIEW_SLOT.heightFog)};
 let mip=roughnessMip(read.z,read.w);
 return ${view(FOG_VIEW_SLOT.skyLightColour)}.rgb*textureSampleLevel(fogCubemap,fogSampler,sceneToCube(direction),mip).rgb;
}`

/** The answers of a program with no cubemap: the fog's own is white, so that the tint alone colours
 *  it, and the sky light does not light the fog. */
const NO_CUBEMAP_TEXT = `fn fogCubeSharp(direction:vec3f)->vec3f{return vec3f(1.0);}
fn fogCubeAverage(direction:vec3f)->vec3f{return vec3f(1.0);}
fn fogSkyLightStrength()->f32{return 0.0;}
fn fogSkyLightColour(direction:vec3f)->vec3f{return vec3f(0.0);}`

/** The volume's sample at \`uvw\`, trilinear, by the sampler. */
const SAMPLE_TEXT = `
fn fogSampleVolume(uvw:vec3f)->vec4f{return textureSampleLevel(fogVolume,fogSampler,uvw,0.0);}`

/** The volume's sample through the filter the run names (the view block's forward lane): the
 *  trilinear one; a cubic B-spline in the plane of the screen, from four bilinear reads; or in the
 *  depth too, from eight. */
const FILTERED_TEXT = `
fn fogSampleFiltered(uvw:vec3f)->vec4f{
 let mode=u32(${view(FOG_VIEW_SLOT.forward)}.w);
 if(mode==0u){return fogSampleVolume(uvw);}
 let cells=${view(FOG_VIEW_SLOT.grid)}.xyz;
 let at=uvw*cells+0.5;
 let floored=floor(at);
 let g=fract(at);
 let o=1.0-g;
 let w0=o*o*o/6.0;
 let w1=2.0/3.0-0.5*g*g*(2.0-g);
 let w2=2.0/3.0-0.5*o*o*(2.0-o);
 let w3=g*g*g/6.0;
 let g0=w0+w1;
 let g1=w2+w3;
 var h0=(w1/g0-1.5+floored)/cells;
 var h1=(w3/g1+0.5+floored)/cells;
 h1=vec3f(min(h1.xy,${view(FOG_VIEW_SLOT.uv)}.zw),h1.z);
 h0.z=uvw.z;
 var t000=mix(fogSampleVolume(vec3f(h1.x,h0.y,h0.z)),fogSampleVolume(h0),g0.x);
 let t010=mix(fogSampleVolume(vec3f(h1.x,h1.y,h0.z)),fogSampleVolume(vec3f(h0.x,h1.y,h0.z)),g0.x);
 t000=mix(t010,t000,g0.y);
 if(mode==1u){return t000;}
 var t001=mix(fogSampleVolume(vec3f(h1.x,h0.y,h1.z)),fogSampleVolume(vec3f(h0.x,h0.y,h1.z)),g0.x);
 let t011=mix(fogSampleVolume(h1),fogSampleVolume(vec3f(h0.x,h1.y,h1.z)),g0.x);
 t001=mix(t011,t001,g0.y);
 return mix(t001,t000,g0.z);
}`

/** The translucent layers read the volume trilinear, the cubic filters left out. */
const TRILINEAR_TEXT = `
fn fogSampleFiltered(uvw:vec3f)->vec4f{return fogSampleVolume(uvw);}`

/** Where the volume is read in the screen for the point at \`uv\` of the view, by a pass that draws the
 *  whole image: at its pixel — the cells' extent over the textures' —, moved by the settings' random
 *  offset in cells (\`stretch.z\`; in pixels, that times the cell's side), the hash of the pixel and of
 *  the image's number, and held to where the cells end. */
const SCREEN_UV_TEXT = `
fn fogReadUV(uv:vec2f)->vec2f{
 let reads=${view(FOG_VIEW_SLOT.uv)};
 var at=uv*reads.xy;
 let jitter=${view(FOG_VIEW_SLOT.stretch)}.z;
 if(jitter!=0.0){
  let cells=${view(FOG_VIEW_SLOT.grid)};
  let extent=cells.xy*cells.w;
  let pixel=vec2i(floor(uv*reads.xy*extent));
  let random=vec2f(rand3dPcg16(vec3i(pixel,i32(${view(FOG_VIEW_SLOT.stretch)}.w))).xy)/65535.0*2.0-1.0;
  at+=random*(jitter*cells.w)/extent;
 }
 return min(at,reads.zw);
}`

/** Where the volume is read for a translucent layer: the point's place in the view, over the share of
 *  the textures the view's cells cover, held to where they end. */
const TRANSLUCENT_UV_TEXT = `
fn fogReadUV(uv:vec2f)->vec2f{
 return min(uv*${view(FOG_VIEW_SLOT.stretch)}.xy,${view(FOG_VIEW_SLOT.uv)}.zw);
}`

/** The volume's read, as a surface's pixel makes it. */
const VOLUME_TEXT = `
/** Whether the scene turns the volume on (the fog block's reach lane) and this image's is built (the
 *  view block's eye lane): the block keeps what the last volume wrote where the scene turns it off,
 *  and is zeroed where it is on and none was built. */
fn fogVolumeBuilt()->bool{return ${reach}.w>0.5&&${view(FOG_VIEW_SLOT.eye)}.w>0.5;}
/** How far along the ray \`toward\` the volume covers the near air: its far end over the cosine of the
 *  ray to the view's forward — the volume is cut at a depth, not at a distance —, none behind the view
 *  or where there is no volume. */
fn fogVolumeExclude(toward:vec3f)->f32{
 if(!fogVolumeBuilt()){return 0.0;}
 let cosine=dot(normalize(toward),${view(FOG_VIEW_SLOT.forward)}.xyz);
 return ${reach}.y*select(0.0,1.0/cosine,cosine>FOG_MIN_COSINE);
}
/** The volume's light and transmittance along \`toward\`, the vector from the eye to a point: read at
 *  the point's screen place (\`fogReadUV\`) and view depth — its distance along the forward, which
 *  an orthographic view's clip weight is not —, and faded in from the volume's start distance by a step, not a
 *  ramp (its own fade is built into it), the light divided by the pre-exposure it was written
 *  multiplied by. */
fn fogVolumeLookup(toward:vec3f)->vec4f{
 let none=vec4f(0.0,0.0,0.0,1.0);
 if(!fogVolumeBuilt()){return none;}
 let clip=${viewProjection()}*vec4f(${view(FOG_VIEW_SLOT.eye)}.xyz+toward,1.0);
 let depth=dot(toward,${view(FOG_VIEW_SLOT.forward)}.xyz);
 let uv=ndcToUv(perspectiveDivide(clip).xy);
 let sliceMap=${view(FOG_VIEW_SLOT.sliceMap)};
 let slice=logSliceOfDepth(depth,sliceMap.xyz)*sliceMap.w;
 let found=fogSampleFiltered(vec3f(fogReadUV(uv),slice));
 let unexposed=vec4f(found.rgb*${view(FOG_VIEW_SLOT.exposure)}.z,found.a);
 return mix(none,unexposed,saturate((depth-${reach}.z)*100000000.0));
}`

/** The light shafts' occlusion mask the fog's inscattering is multiplied by: `lightShaftMask(pixel)`
 *  reads the mask at the scene pixel `pixel` (its centre) through the sampler, bilinear and kept to
 *  the bounds the pass wrote in the view block (`FOG_VIEW_SLOT.lightShaftBounds`). */
const lightShaftText = (b: Required<Pick<FogResourceBindings, 'group' | 'lightShaft'>>) => `
@group(${b.group}) @binding(${b.lightShaft}) var lightShaftMaskTexture:texture_2d<f32>;
fn lightShaftMask(pixel:vec2f)->f32{
  let bounds=${view(FOG_VIEW_SLOT.lightShaftBounds)};
  let uv=clamp(pixel*${view(FOG_VIEW_SLOT.lightShaftScene)}.zw,bounds.xy,bounds.zw);
  return textureSampleLevel(lightShaftMaskTexture,fogSampler,uv,0.0).x;
}`

/** What the fog reads past the light buffer, from a program that binds `b`: its declarations, and
 *  the answers `fogShader.ts` asks for (`fogCubeSharp`, `fogCubeAverage`, `fogSkyLightStrength`,
 *  `fogSkyLightColour`, `fogVolumeExclude`, `fogVolumeLookup`); what `b` leaves out is answered as no
 *  cubemap and no volume would be: white, so that the tint alone colours the fog, no sky light on
 *  it, no volume to exclude and none to read, `(0, 0, 0, 1)`. The program lists it over the fog's
 *  text (`fogWgsl`). */
function fogResourcesWgsl(b: FogResourceBindings): WgslDecl {
  const { group, cubemap, volume, sampler, translucent, lightShaft, localFog } = b
  if (
    (volume !== undefined ||
      cubemap !== undefined ||
      lightShaft !== undefined ||
      b.haze !== undefined) &&
    sampler === undefined
  )
    throw new Error('the cubemap, the volumes and the light shafts are read through a sampler')
  const declarations = [
    sampler === undefined ? '' : `@group(${group}) @binding(${sampler}) var fogSampler:sampler;`,
    volume === undefined
      ? 'fn fogVolumeExclude(toward:vec3f)->f32{return 0.0;}\nfn fogVolumeLookup(toward:vec3f)->vec4f{return vec4f(0.0,0.0,0.0,1.0);}'
      : `@group(${group}) @binding(${volume}) var fogVolume:texture_3d<f32>;${SAMPLE_TEXT}${translucent ? TRILINEAR_TEXT : FILTERED_TEXT}${translucent ? TRANSLUCENT_UV_TEXT : SCREEN_UV_TEXT}${VOLUME_TEXT}`,
    cubemap === undefined ? NO_CUBEMAP_TEXT : cubemapText({ group, cubemap }),
    lightShaft === undefined
      ? 'fn lightShaftMask(pixel:vec2f)->f32{return 1.0;}'
      : lightShaftText({ group, lightShaft }),
  ]
  return wgslBlock(
    `fogResourcesWgsl(${fogBindingsLabel(b)})`,
    // The local fog volumes' lists are declared for a program that holds their code.
    [
      uvToNdc,
      ndcToUv,
      perspectiveDivide,
      rand3dPcg16,
      logSliceOfDepth,
      ...(cubemap === undefined ? [] : [SKY_CUBE_WGSL]),
      ...(localFog === false ? [] : [fogTilesWgsl(b)]),
    ],
    declarations.join('\n'),
  )
}

/** The fog's text a program lists, over the resources it binds as `b` (`fogResourcesWgsl`). The same
 *  bindings give the same text, which a module lists once. */
export const fogBlockOf = (b: FogResourceBindings) =>
  fogWgsl(
    fogResourcesWgsl(b),
    b.localFog !== false,
    b.haze === undefined ? undefined : hazeSampledWgsl(b.group, b.haze),
  )
