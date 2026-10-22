import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { ndcToUv, perspectiveDivide, uvToNdc } from '../../../../math/src/wgsl/projection.ts'
import { FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { fogWgsl } from '../fogShader.ts'
import { FOG_VOLUME_FRAME_WGSL } from './frame.ts'
import { FOG_VIEW_SLOT } from './viewSlots.ts'

/** The structure of the frame, written once for every program that reads it. */
export const FOG_FRAME_STRUCT_WGSL = wgslBlock('FOG_FRAME_STRUCT_WGSL', [], FOG_VOLUME_FRAME_WGSL)

/** Where a program binds what the fog reads past the light buffer, in the bind group `group`: the
 *  cubemap, the volume, and the sampler both are read through. A binding left out answers as no
 *  cubemap or no volume would (`fogResourcesWgsl`). The volume's view — where a surface finds its
 *  cell — is not a binding: it lies in the light buffer (`viewSlots.ts`). `trilinear` reads the
 *  volume through the sampler alone, the cubic filters left out: the forward passes' (the
 *  translucent layers'), as the filters are for the passes that draw the whole image. */
export interface FogResourceBindings {
  readonly group: number
  readonly cubemap?: number
  readonly volume?: number
  readonly sampler?: number
  readonly trilinear?: boolean
}

/** The bindings as a block name reads them, in their declared order. */
export const fogBindingsLabel = (b: FogResourceBindings) =>
  `${b.group}, ${b.cubemap}, ${b.volume}, ${b.sampler}${b.trilinear ? ', trilinear' : ''}`

/** The slot `slot` of the view block, a `vec4f`. */
const view = (slot: number) => `directLights.fogView[${slot}]`
/** The view-projection the volume was built with, from the first four slots. */
const viewProjection = () =>
  `mat4x4f(${[0, 1, 2, 3].map((k) => view(FOG_VIEW_SLOT.projection + k)).join(',')})`

const reach = `directLights.fog[${FOG_SLOT.reach}]`

/** The cubemap's read: its colour along a direction, at its sharpest (level 0) and at its smallest
 *  (the last level, one texel a face), through the sampler — trilinear, seamless across the faces'
 *  edges. The level asked for the smallest is the cubemap's count of levels, past the last, which
 *  the sampler holds to it. */
const cubemapText = (b: Required<Pick<FogResourceBindings, 'group' | 'cubemap'>>) => `
@group(${b.group}) @binding(${b.cubemap}) var fogCubemap:texture_cube<f32>;
fn fogCubeSharp(direction:vec3f)->vec3f{return textureSampleLevel(fogCubemap,fogSampler,direction,0.0).rgb;}
fn fogCubeAverage(direction:vec3f)->vec3f{return textureSampleLevel(fogCubemap,fogSampler,direction,directLights.fog[${FOG_SLOT.cubemap}].z).rgb;}`

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
 *  the point's pixel and view depth, and faded in from the volume's start distance by a step, not a
 *  ramp (its own fade is built into it). */
fn fogVolumeLookup(toward:vec3f)->vec4f{
 let none=vec4f(0.0,0.0,0.0,1.0);
 if(!fogVolumeBuilt()){return none;}
 let clip=${viewProjection()}*vec4f(${view(FOG_VIEW_SLOT.eye)}.xyz+toward,1.0);
 let depth=clip.w;
 let uv=ndcToUv(perspectiveDivide(clip).xy);
 let sliceMap=${view(FOG_VIEW_SLOT.sliceMap)};
 let slice=log2(depth*sliceMap.x+sliceMap.y)*sliceMap.z*sliceMap.w;
 let reads=${view(FOG_VIEW_SLOT.uv)};
 let found=fogSampleFiltered(vec3f(min(uv*reads.xy,reads.zw),slice));
 return mix(none,found,saturate((depth-${reach}.z)*100000000.0));
}`

/** What the fog reads past the light buffer, from a program that binds `b`: its declarations, and
 *  the answers `fogShader.ts` asks for (`fogCubeSharp`, `fogCubeAverage`, `fogVolumeExclude`,
 *  `fogVolumeLookup`); what `b` leaves out is answered as no cubemap and no volume would be: white,
 *  so that the tint alone colours the fog, no volume to exclude and none to read, `(0, 0, 0, 1)`.
 *  The program lists it over the fog's text (`fogWgsl`). */
export function fogResourcesWgsl(b: FogResourceBindings): WgslDecl {
  const { group, cubemap, volume, sampler, trilinear } = b
  if ((volume !== undefined || cubemap !== undefined) && sampler === undefined)
    throw new Error('the cubemap and the volume are read through a sampler')
  const declarations = [
    sampler === undefined ? '' : `@group(${group}) @binding(${sampler}) var fogSampler:sampler;`,
    volume === undefined
      ? 'fn fogVolumeExclude(toward:vec3f)->f32{return 0.0;}\nfn fogVolumeLookup(toward:vec3f)->vec4f{return vec4f(0.0,0.0,0.0,1.0);}'
      : `@group(${group}) @binding(${volume}) var fogVolume:texture_3d<f32>;${SAMPLE_TEXT}${trilinear ? TRILINEAR_TEXT : FILTERED_TEXT}${VOLUME_TEXT}`,
    cubemap === undefined
      ? 'fn fogCubeSharp(direction:vec3f)->vec3f{return vec3f(1.0);}\nfn fogCubeAverage(direction:vec3f)->vec3f{return vec3f(1.0);}'
      : cubemapText({ group, cubemap }),
  ]
  return wgslBlock(
    `fogResourcesWgsl(${fogBindingsLabel(b)})`,
    [uvToNdc, ndcToUv, perspectiveDivide],
    declarations.join('\n'),
  )
}

/** The fog's text a program lists, over the resources it binds as `b` (`fogResourcesWgsl`). The same
 *  bindings give the same text, which a module lists once. */
export const fogBlockOf = (b: FogResourceBindings) => fogWgsl(fogResourcesWgsl(b))
