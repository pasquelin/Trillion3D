import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { HALF_MAX } from '../../../../../math/src/wgsl/constants.ts'
import { isFiniteWord } from '../../../../../math/src/wgsl/integer.ts'
import {
  ndcToUv,
  pixelToNdc,
  unprojectPoint,
  uvToNdc,
} from '../../../../../math/src/wgsl/projection.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { AIR_FOG_BINDINGS, airProgram } from '../../../lighting/atmosphere/programs.ts'
import { fogBlockOf } from '../../../lighting/fog/readWgsl.ts'
import { preExposedWgsl } from '../../../post/exposure/preWgsl.ts'
import type { CloudSetup } from './cloudModes.ts'
import { COMPOSE_AIR_BINDINGS, FOG_ON_CLOUD_WGSL } from './composeWgsl.ts'
import { BOUNDED_READ_WGSL, BOUNDS_FIELD } from './reconstructLayout.ts'
import { MIN_MAX_PATH, MODE2_PATH, firstPath, plainPath } from './reconstructPathsWgsl.ts'

/** The reconstruction's uniform: the matrices at the eye, the reconstructed view, the traced
 *  texel's pixel of the cycle and the shift of the tracing's rays (`offset`, `xy` and `zw`), the
 *  depth terms, the two distances, the bounds of the traced and the history images' reads
 *  (`writeSafeBounds`, `reconstructLayout.ts`), the scales from the view's to the textures'
 *  coordinates of the two, in `xy` and `zw`, the ratio of this image's pre-exposure to the
 *  history's (`exposure.x`), which the history's light is multiplied by, and what the fog laid on
 *  the image is made with (`fog`): this image's pre-exposure (`x`) and the view's pixels a texel of
 *  the image stands for per axis (`y`). */
export const RECONSTRUCT_VIEW = fieldLayout('ReconstructView', [
  ['inverseViewProj', 'mat4x4f'],
  ['previousViewProj', 'mat4x4f'],
  ['destination', 'vec4f'],
  ['offset', 'vec4f'],
  ['depthTerms', 'vec4f'],
  ['distances', 'vec4f'],
  ['traced', BOUNDS_FIELD],
  ['history', BOUNDS_FIELD],
  ['uvScales', 'vec4f'],
  ['exposure', 'vec4f'],
  ['fog', 'vec4f'],
] as const)

/** Where the reconstruction binds what it reads, in its group: 0, or 1 beside the air's where the
 *  fog is laid on the image (`CloudSetup.lateFogOnTranslucent`). The history images (4 to 6) are bound
 *  by the program of an image that has a history, the secondary ones (2 and 5) by the programs of
 *  two surfaces, the half-size depth (8) by the one that reads the pixel's own depth. */
export const RECONSTRUCT_BINDING = {
  view: 0,
  colour: 1,
  secondary: 2,
  depth: 3,
  historyColour: 4,
  historySecondary: 5,
  historyDepth: 6,
  sampler: 7,
  halfDepth: 8,
} as const

const B = RECONSTRUCT_BINDING

/** The depth beyond which a depth is read as the largest a half float holds, kilometres. */
const FAR_DEPTH_KM = 60000

/** A structure of the images a program writes, a target to each: the colour, the secondary colour
 *  (two surfaces), the depth, and the colour with the fog laid on it (`fogged`). */
const outputs = (name: string, minMax: boolean, fogged: boolean) => {
  const fields = [
    'colour',
    ...(minMax ? ['secondary'] : []),
    'depth',
    ...(fogged ? ['fogged'] : []),
  ]
  return `struct ${name}{${fields.map((field, at) => `\n @location(${at}) ${field}:vec4f,`).join('')}\n}`
}

/** What every program declares: the uniform, the traced images, the outputs and the depth, in the
 *  bind group `group`. */
const common = (minMax: boolean, group: number) => `
${RECONSTRUCT_VIEW.wgsl}
@group(${group}) @binding(${B.view}) var<uniform> view:ReconstructView;
@group(${group}) @binding(${B.colour}) var tracedColour:texture_2d<f32>;${
  minMax ? `\n@group(${group}) @binding(${B.secondary}) var tracedSecondary:texture_2d<f32>;` : ''
}
@group(${group}) @binding(${B.depth}) var tracedDepth:texture_2d<f32>;
@group(${group}) @binding(${B.sampler}) var linearSampler:sampler;
${outputs('Reconstructed', minMax, false)}
struct DepthData{front:f32,scene:f32,range:vec2f}
fn depthData(v:vec4f)->DepthData{return DepthData(v.x,v.y,v.zw);}
fn depthVector(d:DepthData)->vec4f{return vec4f(d.front,d.scene,d.range);}
fn sampleTraced(t:texture_2d<f32>,uv:vec2f)->vec4f{return sampleBounded(t,view.traced,uv*view.uvScales.xy);}
`

/** What a program with a history declares besides: the history images and where this pixel's ray
 *  lands in them (`reproject`). The traced texel the pixel lies in is read once, its depth kept. */
const history = (setup: CloudSetup, group: number) => `
@group(${group}) @binding(${B.historyColour}) var historyColour:texture_2d<f32>;${
  setup.minMaxDepth
    ? `\n@group(${group}) @binding(${B.historySecondary}) var historySecondary:texture_2d<f32>;`
    : ''
}
@group(${group}) @binding(${B.historyDepth}) var historyDepth:texture_2d<f32>;
fn sampleHistory(t:texture_2d<f32>,uv:vec2f)->vec4f{return sampleBounded(t,view.history,uv*view.uvScales.zw);}
fn sampleHistoryLight(t:texture_2d<f32>,uv:vec2f)->vec4f{
 let held=sampleHistory(t,uv);
 return vec4f(held.rgb*view.exposure.x,held.a);
}
fn finite4(v:vec4f)->bool{
 return isFiniteWord(bitcast<u32>(v.x))&&isFiniteWord(bitcast<u32>(v.y))&&isFiniteWord(bitcast<u32>(v.z))&&isFiniteWord(bitcast<u32>(v.w));
}
fn finite2(v:vec2f)->bool{return isFiniteWord(bitcast<u32>(v.x))&&isFiniteWord(bitcast<u32>(v.y));}
fn deviceZOfDepth(depthM:f32)->f32{
 return (view.depthTerms.x*depthM+view.depthTerms.y)/(view.depthTerms.z*depthM+view.depthTerms.w);
}
fn fixupDepth(d:DepthData)->DepthData{
 var r=d;
 r.front=select(d.front,HALF_MAX,d.front>${FAR_DEPTH_KM}.0);
 r.scene=select(d.scene,HALF_MAX,d.scene>${FAR_DEPTH_KM}.0);
 r.range=select(d.range,vec2f(HALF_MAX),d.range>vec2f(${FAR_DEPTH_KM}.0));
 return r;
}
struct Taps{colour:vec4f,secondary:vec4f,depth:DepthData}
struct Reprojected{cell:vec2i,tracedNow:bool,previousUv:vec2f,valid:bool,depth:vec4f}
/** The traced texel pixel \`position\` lies in, whether it is the pixel traced now, and where the
 *  ray of the pixel lands in the last image: from the cloud's front depth, read as the depth along
 *  the view axis (an approximation), through the clip matrices of both images without jitter. */
fn reproject(position:vec2f)->Reprojected{
 let pixel=vec2i(position);
 let cell=pixel/${setup.mode.traceDownsample};
 let sub=pixel-cell*${setup.mode.traceDownsample};
 let screen=uvToNdc(position*view.destination.zw);
 let tracedDepth4=loadBounded(tracedDepth,view.traced,cell);
 let frontKm=tracedDepth4.x;
 let current=vec4f(screen,deviceZOfDepth(frontKm*1000.0),1.0);
 let previous=view.previousViewProj*(view.inverseViewProj*current);
 let velocity=screen-previous.xy/previous.w;
 let previousUv=ndcToUv(screen-velocity);
 let valid=all(previousUv>vec2f(0.0))&&all(previousUv<vec2f(1.0))&&frontKm>=view.distances.x;
 return Reprojected(cell,sub.x==i32(view.offset.x)&&sub.y==i32(view.offset.y),previousUv,valid,tracedDepth4);
}
`

/** The depth of the pixel the reconstruction reads, of the half-size image (the plain path). */
const halfDepth = (group: number) => `
@group(${group}) @binding(${B.halfDepth}) var halfDepth:texture_2d<f32>;
`

/** Which path a setup reconstructs with, and so which program. */
export type ReconstructKind = 'first' | 'minMax' | 'plain' | 'mode2'

/** The kind of an image of `setup`, with or without a history. */
export function reconstructKind(setup: CloudSetup, hasHistory: boolean): ReconstructKind {
  if (!hasHistory) return 'first'
  if (setup.mode.index === 2) return 'mode2'
  return setup.minMaxDepth ? 'minMax' : 'plain'
}

/** Whether the program of `kind` binds the half-size depth. */
export const readsHalfDepth = (kind: ReconstructKind) => kind === 'plain'

function pathOf(kind: ReconstructKind, setup: CloudSetup, group: number) {
  switch (kind) {
    case 'first':
      return firstPath(setup.minMaxDepth)
    case 'minMax':
      return MIN_MAX_PATH
    case 'plain':
      return `${halfDepth(group)}${plainPath(setup.boxConstraint)}`
    case 'mode2':
      return MODE2_PATH(setup.mode.traceDownsample)
  }
}

const programs = new Map<string, string>()

/** The fragment entry: the path's pixel, and with the fog laid on the image (`fogged`) that colour
 *  with the fog laid on it, at the cloud's front depth, as one more output. */
const entry = (minMax: boolean, fogged: boolean) =>
  fogged
    ? `
${outputs('ReconstructedFogged', minMax, true)}
@fragment fn reconstructMain(@builtin(position) position:vec4f)->ReconstructedFogged{
 let r=reconstructPixel(position);
 return ReconstructedFogged(r.colour,${minMax ? 'r.secondary,' : ''}r.depth,fogOnCloudAt(position.xy*view.fog.y,r.depth.x,r.colour));
}
`
    : `
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{return reconstructPixel(position);}
`

/**
 * THE RECONSTRUCTION, per pixel of the reconstructed image, from the traced one and the image it
 * reconstructed before (`history`; the first image after a cut has none, and bilinearly upsamples
 * the traced image alone). It writes the colour, the secondary colour and the depth images with two
 * surfaces, the colour and the depth without, and where the translucent surfaces read the image with
 * the fog on it (`CloudSetup.lateFogOnTranslucent`) one more: the colour with the fog laid on it, the
 * fog along the pixel's ray to the cloud's front depth (`fogOnCloudAt`), which makes the program one
 * of the air's family, the air's group the first and its own the second. A program is made for each
 * kind of path (`reconstructKind`), the mode's traced block and, for the plain path, whether the
 * reprojected image is held to its new neighbourhood (`CloudSetup.boxConstraint`); each is made once.
 *
 * With a history, per pixel:
 * - it takes the traced texel it lies in, and is the pixel traced now when its place among the
 *   texel's block is the cycle's offset;
 * - its place in the last image is found from its cloud's front depth — read as the depth along the
 *   view axis, an approximation —, through the clip matrices of both images without jitter; the
 *   reprojection is valid on screen and where that front depth is not nearer than its distance;
 * - with two surfaces (`MIN_MAX_PATH`): depths beyond 60000 km read as the largest half float; the
 *   new sample replaces the history where, near the eye (a depth of the texel's range, or the
 *   scene's, under the distance that disables the disocclusion), the texel's closest and furthest
 *   depths differ by more than 2 km and the scene depth is the closest's, or the history's scene
 *   depth is more than 2 km nearer or further than the new one's; the pixel traced now takes the
 *   new sample; else a valid reprojection takes the history by a bilinear read, the new sample
 *   where the closest depths differ by more than 1 km, and an empty cloud at 1000 km where
 *   anything it read is not finite; else the traced image is read bilinearly;
 * - with one surface, mode 0 (`plainPath`): the pixel traced now takes the new sample; a valid
 *   reprojection takes the history, replaced by the neighbouring sample nearest in scene depth to
 *   the pixel's own where the history's depth is off it by a tenth of it, else held to the box of
 *   the new sample and its eight neighbours when asked; an empty cloud at 1000 km where anything
 *   it read is not finite; else the traced image is read bilinearly;
 * - mode 2 (`MODE2_PATH`): the new sample for the pixel traced now, the history by a bilinear read
 *   where the reprojection is valid, else the traced image read bilinearly, shifted to line up with
 *   the centres of the traced texels.
 * The traced image is read through its bounds, so that no read reaches past the view.
 */
export function reconstructProgram(setup: CloudSetup, hasHistory: boolean, localFog = true) {
  const kind = reconstructKind(setup, hasHistory)
  const fogged = setup.lateFogOnTranslucent
  const key = `${kind}${setup.mode.index}${setup.minMaxDepth}${setup.boxConstraint}${fogged}${localFog}`
  let code = programs.get(key)
  if (code === undefined) {
    // Where the fog is laid on the image, the air's group is the first and the reconstruction's the second.
    const group = fogged ? 1 : 0
    const uses = [FULLSCREEN_VERTEX, BOUNDED_READ_WGSL]
    if (hasHistory) uses.push(HALF_MAX, isFiniteWord, ndcToUv, uvToNdc, pixelToNdc, unprojectPoint)
    const own = `${common(setup.minMaxDepth, group)}${hasHistory ? history(setup, group) : ''}${pathOf(kind, setup, group)}${entry(setup.minMaxDepth, fogged)}`
    code = fogged
      ? airProgram(COMPOSE_AIR_BINDINGS, own, [
          ...uses,
          fogBlockOf({ ...AIR_FOG_BINDINGS, localFog }),
          FOG_ON_CLOUD_WGSL,
          preExposedWgsl('view.fog.x'),
        ]).code
      : wgslProgram(own, uses)
    programs.set(key, code)
  }
  return code
}
