import { COMPUTE, computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import { mipLevelCountFor } from '../texture/tiles.ts'
import { levelViews } from '../texture/mipGroups.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { HDR_FORMAT, hdrUsage } from '../scene/surfaceBuffer.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { GOLDEN_U32 } from '../../../math/src/wgsl/constants.ts'
import { mixWord } from '../../../math/src/wgsl/sampling.ts'
import { storageEntry } from './bindings.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE } from './constants.ts'
import { VIEW_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

/** Levels of the radiance pyramid, level 0 and two a dispatch (`RADIANCE_SHADER`): its coarsest
 *  texel spans 2^(levels − 1) pixels, the widest footprint a reflection reads before it is the
 *  environment's (`reflectionLevelTrust`). */
const RADIANCE_LEVELS = 9
/** Texels of a level one workgroup makes of the level two finer: `REFLECTION_SIDE`, each reading
 *  the four texels of the level between that surround it — a tile of `2 · REFLECTION_SIDE` and a
 *  texel of halo each side. */
const TILE = 2 * REFLECTION_SIDE + 2

/**
 * The radiance pyramid: the lit image of the frame, before the temporal resolve, and its filtered
 * levels, which the next image's reflections read over their footprints. Level 0 is the lit image
 * itself, no copy of it: the frame's HDR target is one of two that take turns (`adoptRadianceImage`),
 * so the one the last image lit stays whole while this image lights the other, and the reflections
 * read it as it is (`reflectionImage`, `footprint.ts`). Its coverage is within one wherever a
 * surface drew — the lighting writes 1 or 0, the blends keep it or blend it over — and it is zero
 * past the drawn size, which the lighting's clear zeroes over the whole target and no pass draws
 * past: the very texels the copy it replaces held. The pyramid holds levels 1 and after, in a
 * texture of half the image's size.
 *
 * Each level is the one before it through the separable tent [1, 3, 3, 1] / 8 on each axis, centred
 * on the coarse texel (the four finer texels around it, the edge's past the drawn image), read as
 * four bilinear taps between texel pairs at a quarter of a texel (`radianceTent`): a smooth,
 * near-Gaussian chain, shift-free, whose B-spline read is a soft blob at every level, never a
 * texel's square. The colour is filtered with its coverage (the lit image's alpha: 1 where a surface
 * drew, 0 on the background, at most 1 at every level), which the reflection divides by, so a
 * footprint never darkens toward the background.
 *
 * Two levels a dispatch: a workgroup makes the tents of the level between for the `REFLECTION_SIDE`²
 * texels of the coarsest level, and of the texel of halo around them, in workgroup memory (each
 * once, its own threads' share, `radianceFill`), writes those it owns, and after one barrier each
 * thread sums the 4 × 4 of them around its texel (`radianceSum`). `radianceFirst` does so from the
 * drawn image, levels 1 and 2; `radianceDown` from each level after. The levels take four
 * dispatches of the drawn size's texels, plus a margin the footprints' reads reach
 * (`radianceThreads`). The image's 8 bytes a pixel are read once and the coarser levels written, a
 * third of it.
 *
 * The first dispatch of an image drawn from where the one before it was (`HeldImage.still`) also
 * folds the image into a 64-bit hash (`radianceHash`, two words of a sum of the texels' mixes,
 * which no order of the threads changes), of the 4 × 4 pixels each thread owns: each thread sums
 * its texels' words, a workgroup adds its threads' by atomics of its own memory and one thread of
 * it adds the workgroup's to the hash of the image (`hash`); `radianceRoll` first moves the last
 * image's to the words beside (`settle.ts`). Only such an image can find the view settled
 * (`reflectionsSettled`), so a moving image hashes nothing (`radianceFirst`), and the still image
 * after it (`radianceFirstBoth`) hashes the image before it too, still whole as its level 0: the
 * two words beside hold what that image would have hashed, the very words, and the view settles on
 * the same image as when every image hashed.
 */
export const RADIANCE_SHADER = wgslProgram(
  `@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var coarser:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(2) var coarsest:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var halves:sampler;
@group(0) @binding(4) var previous:texture_2d<f32>;
@group(0) @binding(5) var<uniform> view:View;
@group(0) @binding(6) var<storage,read_write> hash:array<atomic<u32>>;
var<workgroup> tile:array<vec4f,${TILE * TILE}>;
var<workgroup> folded:array<atomic<u32>,4>;
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
 let origin=vec2i(wg)*${2 * REFLECTION_SIDE}-vec2i(1);
 for(var cell=lane;cell<${TILE * TILE}u;cell+=${REFLECTION_SIDE * REFLECTION_SIDE}u){
  let at=vec2i(i32(cell%${TILE}u),i32(cell/${TILE}u));
  let q=origin+at;
  let texel=radianceTent(clamp(q,vec2i(0),size-vec2i(1)),bounds);
  tile[cell]=texel;
  if(all(at>=vec2i(1))&&all(at<=vec2i(${2 * REFLECTION_SIDE}))&&all(q<size)){textureStore(coarser,q,texel);}
 }
}
fn radianceSum(lid:vec2u,wg:vec2u){
 var sum=vec4f(0.0);
 for(var j=0;j<4;j++){
  for(var i=0;i<4;i++){
   sum+=tent(i)*tent(j)*tile[(2*lid.y+u32(j))*${TILE}u+2*lid.x+u32(i)];
  }
 }
 let c=vec2i(wg*${REFLECTION_SIDE}u+lid);
 if(all(c<vec2i(textureDimensions(coarsest)))){textureStore(coarsest,c,sum/64.0);}
}
fn radianceHash(p:vec2i,texel:vec4f)->vec2u{
 let bits=bitcast<vec4u>(texel);
 let lo=mixWord(bits.x^mixWord(bits.y^mixWord(bits.z^mixWord(bits.w^(u32(p.x)*0x27d4eb2fu+u32(p.y)*0x165667b1u)))));
 return vec2u(lo,mixWord(lo^GOLDEN_U32));
}
fn radianceFold(image:texture_2d<f32>,c:vec2i)->vec2u{
 let size=vec2i(textureDimensions(image));
 let bounds=vec2i(view.viewport.xy);
 var sum=vec2u(0u);
 for(var y=0;y<4;y++){
  for(var x=0;x<4;x++){
   let p=4*c+vec2i(x,y);
   if(all(p<size)&&all(p<bounds)){
    let texel=textureLoad(image,p,0);
    sum+=radianceHash(p,vec4f(texel.rgb,clamp(texel.a,0.0,1.0)));
   }
  }
 }
 return sum;
}
fn radianceAdd(at:u32,sum:vec2u){
 atomicAdd(&folded[at],sum.x);
 atomicAdd(&folded[at+1u],sum.y);
}
fn radianceFlush(lane:u32,at:u32){
 if(lane==0u){
  atomicAdd(&hash[at],atomicLoad(&folded[at]));
  atomicAdd(&hash[at+1u],atomicLoad(&folded[at+1u]));
 }
}
fn radianceLevels(lane:u32,wg:vec2u,lid:vec2u){
 radianceFill(lane,wg,vec2i(view.viewport.xy));
 workgroupBarrier();
 radianceSum(lid,wg);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceFirst(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceLevels(lane,wg.xy,lid.xy);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceFirstHashed(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceLevels(lane,wg.xy,lid.xy);
 radianceAdd(0u,radianceFold(finer,vec2i(wg.xy*${REFLECTION_SIDE}u+lid.xy)));
 workgroupBarrier();
 radianceFlush(lane,0u);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceFirstBoth(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceLevels(lane,wg.xy,lid.xy);
 let c=vec2i(wg.xy*${REFLECTION_SIDE}u+lid.xy);
 radianceAdd(0u,radianceFold(finer,c));
 radianceAdd(2u,radianceFold(previous,c));
 workgroupBarrier();
 radianceFlush(lane,0u);
 radianceFlush(lane,2u);
}
@compute @workgroup_size(1)
fn radianceRoll(){
 atomicStore(&hash[2],atomicLoad(&hash[0]));
 atomicStore(&hash[3],atomicLoad(&hash[1]));
 atomicStore(&hash[0],0u);
 atomicStore(&hash[1],0u);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn radianceDown(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceFill(lane,wg.xy,vec2i(textureDimensions(finer)));
 workgroupBarrier();
 radianceSum(lid.xy,wg.xy);
}`,
  [VIEW_WGSL, mixWord, GOLDEN_U32],
)

/** The radiance pyramid's three layouts (`RADIANCE_SHADER`): a level read through its sampler, the
 *  two levels a dispatch writes, and for the first the image before it (its level 0, which a still
 *  image after a moving one hashes), the lighting's view, whose drawn size it reads, and the
 *  image's hash; for the roll, the hash alone. */
export function radianceLayouts(device: GPUDevice) {
  const finer = computeTextureEntry(0, 'float')
  const halves = { binding: 3, visibility: COMPUTE, sampler: { type: 'filtering' } } as const
  const view = computeBufferEntry(5, 'uniform')
  const hash = computeBufferEntry(6, 'storage')
  return {
    firstLayout: device.createBindGroupLayout({
      entries: [
        finer,
        storageEntry(1),
        storageEntry(2),
        halves,
        computeTextureEntry(4, 'float'),
        view,
        hash,
      ],
    }),
    downLayout: device.createBindGroupLayout({
      entries: [finer, storageEntry(1), storageEntry(2), halves],
    }),
    rollLayout: device.createBindGroupLayout({ entries: [hash] }),
  }
}

/** What the pyramid's build needs of the compiled kernels. */
type RadianceStages = ReturnType<typeof radianceLayouts> & {
  /** The first dispatch: moving, hashing nothing; still, hashing the image; still after a moving
   *  image, hashing the image and the one before it. */
  firstPipeline: GPUComputePipeline
  firstHashedPipeline: GPUComputePipeline
  firstBothPipeline: GPUComputePipeline
  downPipeline: GPUComputePipeline
  rollPipeline: GPUComputePipeline
}

/** The pyramid's levels at `width × height`: an odd count, level 0 and two a dispatch, as many as
 *  the image holds up to `RADIANCE_LEVELS`. */
export const radianceLevels = (width: number, height: number) => {
  const levels = Math.min(RADIANCE_LEVELS, mipLevelCountFor(width, height))
  return levels - ((levels + 1) % 2)
}

/** What a view's radiance pyramid holds: whether it holds an image of this view, the
 *  view-projection and drawn size that image was drawn with — the next image reprojects its hits
 *  with them —, whether the image before it was drawn with the same view-projection and size: an
 *  image traced on it reads the view it is drawn from (`reflectionsSettled`) —, and so whether its
 *  build hashed it (`still`). */
export type HeldImage = {
  valid: boolean
  viewProjection: Float64Array
  size: [number, number]
  still: boolean
}

/**
 * The radiance pyramid of a view at `width × height`: the lit image it holds (`image`, level 0: the
 * HDR target the last image lit, `adoptRadianceImage`), the levels from 1 on in a texture of half
 * that size (`coarse`, level `k` at its mip `k − 1`, each mip's view in `views`, which the build
 * writes then reads), the sampler of its reads, what it holds, and the build's bind groups, kept
 * for each of the two lit images that take turns. Its bytes are those of one pyramid of `levels`
 * levels at `width × height`, the lit image its level 0 (`reflectionBytes`).
 */
export function createRadiancePyramid(device: GPUDevice, width: number, height: number) {
  const levels = radianceLevels(width, height)
  const coarse = device.createTexture({
    label: 'Trillion3D reflection radiance',
    size: [Math.max(1, width >> 1), Math.max(1, height >> 1)],
    format: REFLECTION_FORMAT,
    mipLevelCount: Math.max(1, levels - 1),
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  // The other HDR target: the frame's, the one before's turn about (`adoptRadianceImage`).
  const image = device.createTexture({
    label: 'Trillion3D HDR lighting',
    size: [width, height],
    format: HDR_FORMAT,
    usage: hdrUsage(),
  })
  return {
    width,
    height,
    coarse,
    view: coarse.createView(),
    views: levelViews(coarse),
    image: { texture: image, view: image.createView() },
    /** The pyramid was built this image from the frame's HDR target, which is to become its
     *  level 0 once the image is encoded (`adoptRadianceImage`). */
    fresh: false,
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
    /** The build's groups (`buildGroups`) for each of the lit images it was made over, by the slot
     *  of their identity: the two HDR targets take turns, each finds its groups held. */
    build: {
      identity: createWebgpuBindIdentity(2),
      slots: [] as ({ groups: GPUBindGroup[]; roll: GPUBindGroup } | undefined)[],
    },
  }
}
type RadiancePyramid = ReturnType<typeof createRadiancePyramid>

/** What a build reads and writes beyond the pyramid: the lit image, the lighting's view uniform, and
 *  the buffer that holds the image's hash (`settle.ts`). */
export type RadianceInputs = { hdr: GPUTextureView; view: GPUBuffer; hash: GPUBuffer }

/** The bind groups of a build over `inputs`: the first dispatch's, then one for each two levels
 *  after, and the roll of the hash. Level `k` is the coarse texture's mip `k − 1`. */
function buildGroups(
  device: GPUDevice,
  pyramid: RadiancePyramid,
  { firstLayout, downLayout, rollLayout }: RadianceStages,
  inputs: RadianceInputs,
) {
  const { views, sampler } = pyramid
  const groups = [
    device.createBindGroup({
      layout: firstLayout,
      entries: [
        { binding: 0, resource: inputs.hdr },
        { binding: 1, resource: views[0] },
        { binding: 2, resource: views[1] },
        { binding: 3, resource: sampler },
        { binding: 4, resource: pyramid.image.view },
        { binding: 5, resource: { buffer: inputs.view } },
        { binding: 6, resource: { buffer: inputs.hash } },
      ],
    }),
  ]
  for (let at = 2; at + 2 < pyramid.levels; at += 2)
    groups.push(
      device.createBindGroup({
        layout: downLayout,
        entries: [
          { binding: 0, resource: views[at - 1] },
          { binding: 1, resource: views[at] },
          { binding: 2, resource: views[at + 1] },
          { binding: 3, resource: sampler },
        ],
      }),
    )
  const roll = device.createBindGroup({
    layout: rollLayout,
    entries: [{ binding: 6, resource: { buffer: inputs.hash } }],
  })
  return { groups, roll }
}

/** The threads a side of the dispatch that makes level `level` of an image drawn `drawn` wide, in
 *  a pyramid of `extent`: its texels the drawn image covers, and the two beyond it that a
 *  footprint's cubic read reaches, none past the texels the image would hold if its extent were
 *  not cut down at the level (a thread owns the `2^level` pixels of its texel). */
const radianceThreads = (drawn: number, level: number, extent: number) =>
  Math.min(ceilDiv(drawn, 2 ** level) + 2, ceilDiv(extent, 2 ** level))

/** The workgroups of the dispatch that makes level `level` of an image drawn `size`, in a pyramid
 *  of `extent`. */
const radianceGroups = (
  size: readonly [number, number],
  level: number,
  extent: readonly [number, number],
) => [
  ceilDiv(radianceThreads(size[0], level, extent[0]), REFLECTION_SIDE),
  ceilDiv(radianceThreads(size[1], level, extent[1]), REFLECTION_SIDE),
]

/**
 * The radiance pyramid of the lit image `inputs.hdr`, drawn at `size` with `viewProjection`, in the
 * open compute `pass`: the hash of the last image moved aside, levels 1 and 2 from the image and
 * its hash, then two levels a dispatch from the last made (`RADIANCE_SHADER`); what the pyramid
 * holds is then that image, for the next one's reflections, its level 0 the lit image itself once
 * the image is encoded (`fresh`, `adoptRadianceImage`). `inputs.view` is the lighting's view, whose
 * drawn size the first dispatch reads.
 */
export function encodeRadiancePyramid(
  pass: GPUComputePassEncoder,
  device: GPUDevice,
  pyramid: RadiancePyramid,
  pipelines: RadianceStages,
  inputs: RadianceInputs,
  size: readonly [number, number],
  viewProjection: ArrayLike<number>,
) {
  const { levels, held, build } = pyramid
  if (levels < 3) return
  const { next } = build.identity
  next[0] = inputs.hdr
  next[1] = inputs.view
  next[2] = inputs.hash
  next[3] = pipelines
  next[4] = pyramid.image.view
  next.length = 5
  const moved = build.identity.moved(),
    slot = build.identity.slot
  if (moved || !build.slots[slot])
    build.slots[slot] = buildGroups(device, pyramid, pipelines, inputs)
  const { groups, roll } = build.slots[slot]!
  // Drawn from where the image before it was: hashed, and the image before it too where that one
  // moved and hashed nothing — still whole, the pyramid's level 0.
  const hashedBefore = held.still,
    still =
      held.valid &&
      held.size[0] === size[0] &&
      held.size[1] === size[1] &&
      sameElements(held.viewProjection, viewProjection)
  const first = !still
    ? pipelines.firstPipeline
    : hashedBefore
      ? pipelines.firstHashedPipeline
      : pipelines.firstBothPipeline
  pass.setPipeline(pipelines.rollPipeline)
  pass.setBindGroup(0, roll)
  pass.dispatchWorkgroups(1)
  for (let at = 0; at < groups.length; at++) {
    const [x, y] = radianceGroups(size, 2 * at + 2, [pyramid.width, pyramid.height])
    pass.setBindGroup(0, groups[at])
    pass.setPipeline(at === 0 ? first : pipelines.downPipeline)
    pass.dispatchWorkgroups(x, y)
  }
  held.still = still
  held.valid = true
  copyMatrix4(held.viewProjection, viewProjection)
  held.size[0] = size[0]
  held.size[1] = size[1]
  pyramid.fresh = true
}

/** The HDR target of a frame and the reflection it lights (`WebgpuGpuState`'s). */
type LitTargets = {
  hdrTexture?: GPUTexture
  hdrView?: GPUTextureView
  reflection?: { radiance: RadiancePyramid }
}

/**
 * The image is encoded: the HDR target its pyramid was built from (`fresh`) becomes the pyramid's
 * level 0, which the next image's reflections read, and the one that was level 0 becomes the HDR
 * target the next image lights. References traded, nothing copied, nothing made: what every pass
 * of this image recorded stays on the textures it named. Called once every pass of the image that
 * reads or writes the HDR target is encoded (`encodeSurfaceLighting`).
 */
export function adoptRadianceImage(gpu: LitTargets) {
  const radiance = gpu.reflection?.radiance
  if (!radiance?.fresh || !gpu.hdrTexture || !gpu.hdrView) return
  const { image } = radiance,
    texture = image.texture,
    view = image.view
  image.texture = gpu.hdrTexture
  image.view = gpu.hdrView
  gpu.hdrTexture = texture
  gpu.hdrView = view
  radiance.fresh = false
}
