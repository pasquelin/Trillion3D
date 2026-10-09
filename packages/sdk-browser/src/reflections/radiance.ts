import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { mipLevelCountFor } from '../texture/tiles.ts'
import { levelViews } from '../texture/mipGroups.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { sameEntries } from '../gpu/core/sameEntries.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { computeLayout, storageEntry } from './bindings.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE as SIDE } from './constants.ts'
import { REFLECTION_VIEW_WGSL } from './viewLayout.ts'

/** Levels of the radiance pyramid, level 0 and two a dispatch (`RADIANCE_SHADER`): its coarsest
 *  texel spans 2^(levels − 1) pixels, the widest footprint a reflection reads before it is the
 *  environment's (`reflectionLevelTrust`). */
const RADIANCE_LEVELS = 9
/** Texels of a level one workgroup makes of the level two finer: `SIDE`, each reading the four
 *  texels of the level between that surround it — a tile of `2 · SIDE` and a texel of halo each
 *  side. */
const TILE = 2 * SIDE + 2

/**
 * The radiance pyramid: the lit image of the frame, before the temporal resolve, and its filtered
 * levels, which the next image's reflections read over their footprints. Each level is the one
 * before it through the separable tent [1, 3, 3, 1] / 8 on each axis, centred on the coarse texel
 * (the four finer texels around it, the edge's past the drawn image), read as four bilinear taps
 * between texel pairs at a quarter of a texel (`radianceTent`): a smooth, near-Gaussian chain,
 * shift-free, whose B-spline read is a soft blob at every level, never a texel's square. The colour
 * is filtered with its coverage (the lit image's alpha: 1 where a surface drew, 0 on the
 * background, at most 1 at every level), which the reflection divides by, so a footprint never
 * darkens toward the background.
 *
 * Two levels a dispatch: a workgroup makes the tents of the level between for its `SIDE × SIDE`
 * texels of the coarsest level, and of the texel of halo around them, in workgroup memory (each
 * once, its own threads' share, `radianceFill`), writes those it owns, and after one barrier each
 * thread sums the 4 × 4 of them around its texel (`radianceSum`). `radianceFirst` does so from the
 * drawn image and copies the 4 × 4 pixels each thread owns into level 0; `radianceDown` from each
 * level after. The levels take four dispatches of the drawn size's texels, plus a margin the
 * footprints' reads reach (`radianceThreads`). The image's 8 bytes a pixel are read once, level 0
 * written once and the coarser levels a third of it.
 */
export const RADIANCE_SHADER = wgslProgram(
  `@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var coarser:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(2) var coarsest:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var halves:sampler;
@group(0) @binding(4) var copy:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(5) var<uniform> reflectionView:ReflectionView;
var<workgroup> tile:array<vec4f,${TILE * TILE}>;
fn tent(k:i32)->f32{return select(1.0,3.0,k==1||k==2);}
fn radianceTent(q:vec2i,bounds:vec2i)->vec4f{
 let size=vec2f(textureDimensions(finer));
 let last=vec2f(bounds-vec2i(1));
 let low=(clamp(vec2f(2*q)-vec2f(0.25),vec2f(0.0),last)+vec2f(0.5))/size;
 let high=(clamp(vec2f(2*q)+vec2f(1.25),vec2f(0.0),last)+vec2f(0.5))/size;
 let sum=textureSampleLevel(finer,halves,low,0.0)+textureSampleLevel(finer,halves,vec2f(high.x,low.y),0.0)
  +textureSampleLevel(finer,halves,vec2f(low.x,high.y),0.0)+textureSampleLevel(finer,halves,high,0.0);
 return vec4f(sum.rgb,min(sum.a,4.0))/4.0;
}
fn radianceFill(lane:u32,wg:vec2u,bounds:vec2i){
 let size=vec2i(textureDimensions(coarser));
 let origin=vec2i(wg)*${2 * SIDE}-vec2i(1);
 for(var cell=lane;cell<${TILE * TILE}u;cell+=${SIDE * SIDE}u){
  let at=vec2i(i32(cell%${TILE}u),i32(cell/${TILE}u));
  let q=origin+at;
  let texel=radianceTent(clamp(q,vec2i(0),size-vec2i(1)),bounds);
  tile[cell]=texel;
  if(all(at>=vec2i(1))&&all(at<=vec2i(${2 * SIDE}))&&all(q<size)){textureStore(coarser,q,texel);}
 }
}
fn radianceSum(lid:vec2u,wg:vec2u){
 var sum=vec4f(0.0);
 for(var j=0;j<4;j++){
  for(var i=0;i<4;i++){
   sum+=tent(i)*tent(j)*tile[(2*lid.y+u32(j))*${TILE}u+2*lid.x+u32(i)];
  }
 }
 let c=vec2i(wg*${SIDE}u+lid);
 if(all(c<vec2i(textureDimensions(coarsest)))){textureStore(coarsest,c,sum/64.0);}
}
fn radianceCopy(c:vec2i){
 let size=vec2i(textureDimensions(copy));
 let bounds=vec2i(reflectionView.screen.xy);
 for(var y=0;y<4;y++){
  for(var x=0;x<4;x++){
   let p=4*c+vec2i(x,y);
   if(all(p<size)){
    let texel=select(vec4f(0.0),textureLoad(finer,p,0),all(p<bounds));
    textureStore(copy,p,vec4f(texel.rgb,clamp(texel.a,0.0,1.0)));
   }
  }
 }
}
@compute @workgroup_size(${SIDE},${SIDE})
fn radianceFirst(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceFill(lane,wg.xy,vec2i(reflectionView.screen.xy));
 workgroupBarrier();
 radianceSum(lid.xy,wg.xy);
 radianceCopy(vec2i(wg.xy*${SIDE}u+lid.xy));
}
@compute @workgroup_size(${SIDE},${SIDE})
fn radianceDown(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceFill(lane,wg.xy,vec2i(textureDimensions(finer)));
 workgroupBarrier();
 radianceSum(lid.xy,wg.xy);
}`,
  [REFLECTION_VIEW_WGSL],
)

/** The radiance pyramid's two layouts (`RADIANCE_SHADER`): a level read through its sampler, the
 *  two levels a dispatch writes, and for the first, level 0 and the view, whose drawn size it
 *  reads. */
export function radianceLayouts(device: GPUDevice) {
  const finer = { binding: 0, visibility: COMPUTE, texture: { sampleType: 'float' } } as const
  const halves = { binding: 3, visibility: COMPUTE, sampler: { type: 'filtering' } } as const
  const view = { binding: 5, visibility: COMPUTE, buffer: { type: 'uniform' } } as const
  return {
    firstLayout: computeLayout(device, [
      finer,
      storageEntry(1),
      storageEntry(2),
      halves,
      storageEntry(4),
      view,
    ]),
    downLayout: computeLayout(device, [finer, storageEntry(1), storageEntry(2), halves]),
  }
}

/** What the pyramid's build needs of the compiled kernels. */
type RadianceStages = ReturnType<typeof radianceLayouts> & {
  firstPipeline: GPUComputePipeline
  downPipeline: GPUComputePipeline
}

/** The pyramid's levels at `width × height`: an odd count, level 0 and two a dispatch, as many as
 *  the image holds up to `RADIANCE_LEVELS`. */
export const radianceLevels = (width: number, height: number) => {
  const levels = Math.min(RADIANCE_LEVELS, mipLevelCountFor(width, height))
  return levels - ((levels + 1) % 2)
}

/** What a view's radiance pyramid holds: whether it holds an image of this view, the
 *  view-projection and drawn size that image was drawn with — the next image reprojects its hits
 *  with them — and whether the image before it was drawn with the same view-projection: an image
 *  traced on it reads the view it is drawn from (`reflectionsSettled`). */
type HeldImage = {
  valid: boolean
  viewProjection: Float64Array
  size: [number, number]
  still: boolean
}

/**
 * The radiance pyramid of a view at `width × height`: its texture, each level's view — which the
 * build writes then reads —, the sampler of its reads, the image it holds, and the build's bind
 * groups, kept while the lit image stays.
 */
export function createRadiancePyramid(device: GPUDevice, width: number, height: number) {
  const levels = radianceLevels(width, height)
  const texture = device.createTexture({
    label: 'Trillion3D reflection radiance',
    size: [width, height],
    format: REFLECTION_FORMAT,
    mipLevelCount: levels,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  return {
    texture,
    view: texture.createView(),
    views: levelViews(texture),
    levels,
    sampler: device.createSampler({
      label: 'Trillion3D reflection radiance',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    }),
    held: {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0],
      still: false,
    } as HeldImage,
    build: undefined as { key: unknown[]; groups: GPUBindGroup[] } | undefined,
  }
}
export type RadiancePyramid = ReturnType<typeof createRadiancePyramid>

/** The bind groups of a build over the lit image `hdr` and the view uniform `uniform`: the first
 *  dispatch's, then one for each two levels after. */
function buildGroups(
  device: GPUDevice,
  pyramid: RadiancePyramid,
  { firstLayout, downLayout }: RadianceStages,
  hdr: GPUTextureView,
  uniform: GPUBuffer,
) {
  const { views, sampler } = pyramid
  const groups = [
    device.createBindGroup({
      layout: firstLayout,
      entries: [
        { binding: 0, resource: hdr },
        { binding: 1, resource: views[1] },
        { binding: 2, resource: views[2] },
        { binding: 3, resource: sampler },
        { binding: 4, resource: views[0] },
        { binding: 5, resource: { buffer: uniform } },
      ],
    }),
  ]
  for (let at = 2; at + 2 < pyramid.levels; at += 2)
    groups.push(
      device.createBindGroup({
        layout: downLayout,
        entries: [
          { binding: 0, resource: views[at] },
          { binding: 1, resource: views[at + 1] },
          { binding: 2, resource: views[at + 2] },
          { binding: 3, resource: sampler },
        ],
      }),
    )
  return groups
}

/** The threads a side of the dispatch that makes level `level` of an image drawn `drawn` wide: its
 *  texels the drawn image covers, and the two beyond it that a footprint's cubic read reaches. */
const radianceThreads = (drawn: number, level: number, extent: number) =>
  clamp(extent >> level, 1, ceilDiv(drawn, 2 ** level) + 2)

const probe: unknown[] = []

/**
 * The radiance pyramid of the lit image `hdr`, drawn at `size` with `viewProjection`, in the open
 * compute `pass`: levels 0, 1 and 2 from the image, then two levels a dispatch from the last made
 * (`RADIANCE_SHADER`); what the pyramid holds is then that image, for the next one's reflections.
 * `uniform` is the view's, whose drawn size the first dispatch reads.
 */
export function encodeRadiancePyramid(
  pass: GPUComputePassEncoder,
  device: GPUDevice,
  pyramid: RadiancePyramid,
  pipelines: RadianceStages,
  inputs: { hdr: GPUTextureView; uniform: GPUBuffer },
  size: readonly [number, number],
  viewProjection: ArrayLike<number>,
) {
  const { levels, held, texture } = pyramid
  if (levels < 3) return
  probe.length = 0
  probe.push(inputs.hdr, inputs.uniform, pipelines)
  if (!pyramid.build || !sameEntries(pyramid.build.key, probe))
    pyramid.build = {
      key: probe.slice(),
      groups: buildGroups(device, pyramid, pipelines, inputs.hdr, inputs.uniform),
    }
  const { groups } = pyramid.build
  for (let at = 0; at < groups.length; at++) {
    const level = 2 * at + 2
    pass.setBindGroup(0, groups[at])
    pass.setPipeline(at === 0 ? pipelines.firstPipeline : pipelines.downPipeline)
    pass.dispatchWorkgroups(
      ceilDiv(radianceThreads(size[0], level, texture.width), SIDE),
      ceilDiv(radianceThreads(size[1], level, texture.height), SIDE),
    )
  }
  held.still =
    held.valid &&
    held.size[0] === size[0] &&
    held.size[1] === size[1] &&
    sameElements(held.viewProjection, viewProjection)
  held.valid = true
  copyMatrix4(held.viewProjection, viewProjection)
  held.size[0] = size[0]
  held.size[1] = size[1]
}
