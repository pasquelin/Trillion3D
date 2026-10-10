import { COMPUTE, computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import { mipLevelCountFor } from '../texture/tiles.ts'
import { levelViews } from '../texture/mipGroups.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { sameEntries } from '../gpu/core/sameEntries.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { storageEntry } from './bindings.ts'
import { REFLECTION_FORMAT, REFLECTION_SIDE as SIDE } from './constants.ts'
import { VIEW_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

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
 *
 * The first dispatch also folds the image it copies into a 64-bit hash (`radianceHash`, two words
 * of a sum of the texels' mixes, which no order of the threads changes): each thread sums its
 * texels' words, a workgroup adds its threads' by atomics of its own memory and one thread of it
 * adds the workgroup's to the hash of the image (`hash`); `radianceRoll` first moves the last
 * image's to the words beside (`settle.ts`).
 */
export const RADIANCE_SHADER = wgslProgram(
  `@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var coarser:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(2) var coarsest:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var halves:sampler;
@group(0) @binding(4) var copy:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(5) var<uniform> view:View;
@group(0) @binding(6) var<storage,read_write> hash:array<atomic<u32>>;
var<workgroup> tile:array<vec4f,${TILE * TILE}>;
var<workgroup> folded:array<atomic<u32>,2>;
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
fn radianceMix(x:u32)->u32{
 var h=x*0x9e3779b1u;
 h^=h>>15u;h*=0x85ebca77u;h^=h>>13u;
 return h;
}
fn radianceHash(p:vec2i,texel:vec4f)->vec2u{
 let bits=bitcast<vec4u>(texel);
 let lo=radianceMix(bits.x^radianceMix(bits.y^radianceMix(bits.z^radianceMix(bits.w^(u32(p.x)*0x27d4eb2fu+u32(p.y)*0x165667b1u)))));
 return vec2u(lo,radianceMix(lo^0x2545f491u));
}
fn radianceCopy(c:vec2i)->vec2u{
 let size=vec2i(textureDimensions(copy));
 let bounds=vec2i(view.viewport.xy);
 var sum=vec2u(0u);
 for(var y=0;y<4;y++){
  for(var x=0;x<4;x++){
   let p=4*c+vec2i(x,y);
   if(all(p<size)){
    let inside=all(p<bounds);
    let texel=select(vec4f(0.0),textureLoad(finer,p,0),inside);
    let stored=vec4f(texel.rgb,clamp(texel.a,0.0,1.0));
    textureStore(copy,p,stored);
    if(inside){sum+=radianceHash(p,stored);}
   }
  }
 }
 return sum;
}
@compute @workgroup_size(${SIDE},${SIDE})
fn radianceFirst(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceFill(lane,wg.xy,vec2i(view.viewport.xy));
 workgroupBarrier();
 radianceSum(lid.xy,wg.xy);
 let sum=radianceCopy(vec2i(wg.xy*${SIDE}u+lid.xy));
 atomicAdd(&folded[0],sum.x);
 atomicAdd(&folded[1],sum.y);
 workgroupBarrier();
 if(lane==0u){
  atomicAdd(&hash[0],atomicLoad(&folded[0]));
  atomicAdd(&hash[1],atomicLoad(&folded[1]));
 }
}
@compute @workgroup_size(1)
fn radianceRoll(){
 atomicStore(&hash[2],atomicLoad(&hash[0]));
 atomicStore(&hash[3],atomicLoad(&hash[1]));
 atomicStore(&hash[0],0u);
 atomicStore(&hash[1],0u);
}
@compute @workgroup_size(${SIDE},${SIDE})
fn radianceDown(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 radianceFill(lane,wg.xy,vec2i(textureDimensions(finer)));
 workgroupBarrier();
 radianceSum(lid.xy,wg.xy);
}`,
  [VIEW_WGSL],
)

/** The radiance pyramid's three layouts (`RADIANCE_SHADER`): a level read through its sampler, the
 *  two levels a dispatch writes, and for the first, level 0, the lighting's view, whose drawn size
 *  it reads, and the image's hash; for the roll, the hash alone. */
export function radianceLayouts(device: GPUDevice) {
  const finer = computeTextureEntry(0, 'float')
  const halves = { binding: 3, visibility: COMPUTE, sampler: { type: 'filtering' } } as const
  const view = computeBufferEntry(5, 'uniform')
  const hash = computeBufferEntry(6, 'storage')
  return {
    firstLayout: device.createBindGroupLayout({
      entries: [finer, storageEntry(1), storageEntry(2), halves, storageEntry(4), view, hash],
    }),
    downLayout: device.createBindGroupLayout({
      entries: [finer, storageEntry(1), storageEntry(2), halves],
    }),
    rollLayout: device.createBindGroupLayout({ entries: [hash] }),
  }
}

/** What the pyramid's build needs of the compiled kernels. */
type RadianceStages = ReturnType<typeof radianceLayouts> & {
  firstPipeline: GPUComputePipeline
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
 *  with them — and whether the image before it was drawn with the same view-projection: an image
 *  traced on it reads the view it is drawn from (`reflectionsSettled`). */
export type HeldImage = {
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
    build: undefined as { key: unknown[]; groups: GPUBindGroup[]; roll: GPUBindGroup } | undefined,
  }
}
type RadiancePyramid = ReturnType<typeof createRadiancePyramid>

/** What a build reads and writes beyond the pyramid: the lit image, the lighting's view uniform, and
 *  the buffer that holds the image's hash (`settle.ts`). */
export type RadianceInputs = { hdr: GPUTextureView; view: GPUBuffer; hash: GPUBuffer }

/** The bind groups of a build over `inputs`: the first dispatch's, then one for each two levels
 *  after, and the roll of the hash. */
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
        { binding: 1, resource: views[1] },
        { binding: 2, resource: views[2] },
        { binding: 3, resource: sampler },
        { binding: 4, resource: views[0] },
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
          { binding: 0, resource: views[at] },
          { binding: 1, resource: views[at + 1] },
          { binding: 2, resource: views[at + 2] },
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
  ceilDiv(radianceThreads(size[0], level, extent[0]), SIDE),
  ceilDiv(radianceThreads(size[1], level, extent[1]), SIDE),
]

const probe: unknown[] = []

/**
 * The radiance pyramid of the lit image `inputs.hdr`, drawn at `size` with `viewProjection`, in the
 * open compute `pass`: the hash of the last image moved aside, levels 0, 1 and 2 from the image and
 * its hash, then two levels a dispatch from the last made (`RADIANCE_SHADER`); what the pyramid
 * holds is then that image, for the next one's reflections. `inputs.view` is the lighting's view,
 * whose drawn size the first dispatch reads.
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
  const { levels, held, texture } = pyramid
  if (levels < 3) return
  probe.length = 0
  probe.push(inputs.hdr, inputs.view, inputs.hash, pipelines)
  if (!pyramid.build || !sameEntries(pyramid.build.key, probe))
    pyramid.build = { key: probe.slice(), ...buildGroups(device, pyramid, pipelines, inputs) }
  const { groups, roll } = pyramid.build
  pass.setPipeline(pipelines.rollPipeline)
  pass.setBindGroup(0, roll)
  pass.dispatchWorkgroups(1)
  for (let at = 0; at < groups.length; at++) {
    const [x, y] = radianceGroups(size, 2 * at + 2, [texture.width, texture.height])
    pass.setBindGroup(0, groups[at])
    pass.setPipeline(at === 0 ? pipelines.firstPipeline : pipelines.downPipeline)
    pass.dispatchWorkgroups(x, y)
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
