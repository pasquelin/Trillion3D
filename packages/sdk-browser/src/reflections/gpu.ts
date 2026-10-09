import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { validated } from '../gpu/core/errorScope.ts'
import { shaderFailed } from '../gpu/core/shaderModule.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { TONE_UNMAPPING_WGSL } from '../lighting/toneMappingWgsl.ts'
import { mipLevelCountFor } from '../texture/tiles.ts'
import { SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts'
import { LOBE_PACK_WGSL, PHYSICAL_SURFACE_FLAG } from '../scene/physicalLobes.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../sdk-core/src/scene/core/environment.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { vectorRejection } from '../../../math/src/wgsl/geometry.ts'
import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_GROUP,
  REFLECTION_VIEW_BYTES,
  REFLECTION_VIEW_WGSL,
  REFLECTION_VIEW_WRITTEN_BYTES,
  reflectedRadianceWgsl,
} from './wgsl.ts'

/** The reflection target's and the radiance pyramid's format: the lit image's. */
export const REFLECTION_FORMAT: GPUTextureFormat = 'rgba16float'
/** Levels of the radiance pyramid: its coarsest texel spans 2^(levels − 1) pixels, the widest
 *  footprint a reflection reads before it is the environment's (`REFLECTION_TRACE_ROUGHNESS`). */
export const REFLECTION_RADIANCE_LEVELS = 8
/** Threads per side of a reflection workgroup: one pixel or one texel each. */
const SIDE = 8
/** Pixels per side of the radiance pyramid's first workgroup tile. */
const TILE = 16
/** The surface flag of a lit standard surface (`../scene/surfaceModel.ts`): the one the opaque
 *  trace marches for; the diffuse and toon models reflect nothing, the background and the unlit
 *  and as-is surfaces neither. */
const LIT_STANDARD_FLAG = 2

/**
 * The opaque surfaces' reflection, one compute pass at full resolution: each pixel of a lit
 * standard surface writes the radiance it reflects (`reflectedRadiance`), every other pixel zero;
 * the opaque resolve weighs it (`resolvedReflectionWgsl`). A pixel past the trace's roughness reads
 * the environment alone, inside the same function. Its lobe is the one its lights read: where the
 * surface carries the physical lobes (`PHYSICAL_SURFACE_FLAG`), their direction, kept orthogonal to
 * the normal, and αt = mix(α, 1, strength²) along it (`setLobes`); else a round lobe of rough².
 */
export const TRACE_SHADER = wgslProgram(
  `@group(0) @binding(0) var traceFlags:texture_2d<u32>;
@group(0) @binding(1) var traceNormals:texture_2d<f32>;
@group(0) @binding(2) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var<storage,read> directLights:DirectLights;
@group(0) @binding(4) var traceLobes:texture_2d<u32>;
fn traceLobe(coord:vec2i,flags:u32,N:vec3f,rough:f32)->vec4f{
 let alpha=rough*rough;
 if((flags&${PHYSICAL_SURFACE_FLAG}u)==0u){return vec4f(0.0,0.0,0.0,alpha);}
 let w=textureLoad(traceLobes,coord,0);
 let strength=unpack2x16unorm(w.z).x;
 let t=vectorRejection(lobeOctDecode(w.x),N);let l=dot(t,t);
 if(!(l>1e-12)||!(strength>0.0)){return vec4f(0.0,0.0,0.0,alpha);}
 return vec4f(t*inverseSqrt(l),mix(alpha,1.0,strength*strength));
}
@compute @workgroup_size(${SIDE},${SIDE})
fn traceReflections(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=reflectionView.screen.xy)){return;}
 let coord=vec2i(id.xy);
 var radiance=vec3f(0.0);
 let flags=textureLoad(traceFlags,coord,0).r;
 if((flags&${SURFACE_MODEL_MASK}u)==${LIT_STANDARD_FLAG}u){
  let P=reflectionWorldAt(vec2f(id.xy)+vec2f(0.5),textureLoad(hizDepth,coord,0).r);
  let normal=textureLoad(traceNormals,coord,0);
  let N=normalize(normal.xyz);
  let rough=clamp(normal.a,ROUGHNESS_FLOOR,1.0);
  radiance=reflectedRadiance(P,N,reflectionToEye(P),rough,traceLobe(coord,flags,N,rough));
 }
 textureStore(traceOut,coord,vec4f(radiance,1.0));
}`,
  [directLightWgsl(), reflectedRadianceWgsl(REFLECTION_GROUP), LOBE_PACK_WGSL, vectorRejection],
)

/**
 * The radiance around the scene a miss adds to the environment's coefficients (`surroundings`,
 * `reflectionEnvironment`), one thread an image: where the scene declares no light around it — its
 * nine coefficients all zero —, the background the view shows, as a mirror must show it — the
 * radiance the display curve and the exposure turn into the background's displayed value
 * (`toneUnmap`) —; zero where it declares one, which then answers alone.
 */
export const SURROUNDINGS_SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read> directLights:DirectLights;
@group(0) @binding(1) var<storage,read_write> view:ReflectionView;
@compute @workgroup_size(1)
fn reflectionSurroundings(){
 var declared=false;
 for(var k=0u;k<${ENVIRONMENT_COEFFICIENTS}u;k++){declared=declared||any(directLights.environment[k].rgb!=vec3f(0.0));}
 let shown=toneUnmap(view.display.rgb,view.counts.y)/view.display.w;
 view.surroundings=vec4f(select(shown,vec3f(0.0),declared),0.0);
}`,
  [directLightWgsl(), REFLECTION_VIEW_WGSL, TONE_UNMAPPING_WGSL],
)

/**
 * The radiance pyramid: the lit image of the frame, before the temporal resolve, and its filtered
 * levels, which the next image's reflections read over their footprints. Each level is the one
 * before it through the separable tent [1, 3, 3, 1] / 8 on each axis, centred on the coarse texel
 * (the four finer texels around it, zero past the image): a smooth, near-Gaussian chain, whose
 * trilinear read is a soft blob at every level, never a texel's square. The colour is filtered
 * with its coverage (the lit image's alpha: 1 where a surface drew, 0 on the background), so a
 * footprint over a silhouette reads the background's share as uncovered, which the reflection
 * fills with the environment.
 *
 * `radianceFirst` reads the drawn image once into a workgroup tile of `TILE` pixels a side and its
 * one-pixel apron, copies the tile into level 0 and filters level 1 from it; `radianceDown` makes
 * each further level from the one before. Per image, of the image's 8 bytes a pixel: one read and
 * one write at level 0, then a quarter written at level 1, and below it a third of a quarter read
 * and a twelfth written — 1.33 reads and 1.33 writes of the image, `REFLECTION_RADIANCE_LEVELS` − 1
 * dispatches; at 2.35 Mpx, 50 MB, a quarter of a millisecond at 200 GB/s.
 */
export const RADIANCE_SHADER = wgslProgram(
  `@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var coarser:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(2) var copy:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var<uniform> drawn:vec4u;
const APRON:u32=${TILE + 2}u;
var<workgroup> tile:array<vec4f,${(TILE + 2) * (TILE + 2)}>;
fn tent(k:u32)->f32{return select(1.0,3.0,k==1u||k==2u);}
fn radianceAt(p:vec2i)->vec4f{
 if(any(p<vec2i(0))||any(p>=vec2i(drawn.xy))){return vec4f(0.0);}
 let c=textureLoad(finer,p,0);
 return vec4f(c.rgb,clamp(c.a,0.0,1.0));
}
@compute @workgroup_size(${TILE},${TILE})
fn radianceFirst(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) index:u32){
 let origin=vec2i(group.xy*${TILE}u)-vec2i(1);
 for(var k=index;k<APRON*APRON;k+=${TILE * TILE}u){tile[k]=radianceAt(origin+vec2i(vec2u(k%APRON,k/APRON)));}
 workgroupBarrier();
 let p=group.xy*${TILE}u+local.xy;
 if(all(p<textureDimensions(copy))){textureStore(copy,p,tile[(local.y+1u)*APRON+local.x+1u]);}
 let id=group.xy*${TILE / 2}u+local.xy;
 if(any(local.xy>=vec2u(${TILE / 2}u))||any(id>=textureDimensions(coarser))){return;}
 var sum=vec4f(0.0);
 for(var y=0u;y<4u;y++){
  for(var x=0u;x<4u;x++){sum+=tent(x)*tent(y)*tile[(2u*local.y+y)*APRON+2u*local.x+x];}
 }
 textureStore(coarser,id,sum/64.0);
}
@compute @workgroup_size(${SIDE},${SIDE})
fn radianceDown(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(coarser))){return;}
 let size=vec2i(textureDimensions(finer));
 let low=vec2i(id.xy*2u)-vec2i(1);
 var sum=vec4f(0.0);
 for(var y=0;y<4;y++){
  for(var x=0;x<4;x++){
   let p=low+vec2i(x,y);
   if(all(p>=vec2i(0))&&all(p<size)){sum+=tent(u32(x))*tent(u32(y))*textureLoad(finer,p,0);}
  }
 }
 textureStore(coarser,id.xy,sum/64.0);
}`,
  [],
)

const storage = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: 'write-only', format: REFLECTION_FORMAT },
})

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, the
 *  radiance pyramid and its sampler, then the depth pyramid (`hizDepthEntries`), read by compute
 *  and fragment stages. */
export const reflectionLayout = oncePerDevice((device: GPUDevice) => {
  const visibility = COMPUTE | GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    label: 'Trillion3D reflection',
    entries: [
      {
        binding: 0,
        visibility,
        buffer: { type: 'uniform', minBindingSize: REFLECTION_VIEW_BYTES },
      },
      { binding: 1, visibility, texture: { sampleType: 'float' } },
      { binding: 2, visibility, sampler: { type: 'filtering' } },
      ...hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility),
    ],
  })
})

/** The reflection's kernels — the surroundings, the opaque trace, the radiance pyramid's two —
 *  compiled once a device under one validation scope. */
export const createReflectionPipelines = oncePerDevice((device: GPUDevice) =>
  validated(device, async () => {
    const trace = device.createShaderModule({
      label: 'Trillion3D reflection trace',
      code: TRACE_SHADER,
    })
    const surroundings = device.createShaderModule({
      label: 'Trillion3D reflection surroundings',
      code: SURROUNDINGS_SHADER,
    })
    const radiance = device.createShaderModule({
      label: 'Trillion3D reflection radiance',
      code: RADIANCE_SHADER,
    })
    for (const made of [trace, surroundings, radiance])
      if (await shaderFailed(made)) return undefined
    const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
    const traceLayout = layout([
      { binding: 0, visibility: COMPUTE, texture: { sampleType: 'uint' } },
      { binding: 1, visibility: COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      storage(2),
      { binding: 3, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: COMPUTE, texture: { sampleType: 'uint' } },
    ])
    const surroundingsLayout = layout([
      { binding: 0, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: COMPUTE, buffer: { type: 'storage' } },
    ])
    const finer: GPUBindGroupLayoutEntry = {
      binding: 0,
      visibility: COMPUTE,
      texture: { sampleType: 'unfilterable-float' },
    }
    const firstLayout = layout([
      finer,
      storage(1),
      storage(2),
      { binding: 3, visibility: COMPUTE, buffer: { type: 'uniform' } },
    ])
    const downLayout = layout([finer, storage(1)])
    const stage = (made: GPUShaderModule, entryPoint: string, groups: GPUBindGroupLayout[]) =>
      buildComputePipeline(device, {
        layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
        compute: { module: made, entryPoint },
      })
    const [tracePipeline, surroundingsPipeline, firstPipeline, downPipeline] = await Promise.all([
      stage(trace, 'traceReflections', [traceLayout, reflectionLayout(device)]),
      stage(surroundings, 'reflectionSurroundings', [surroundingsLayout]),
      stage(radiance, 'radianceFirst', [firstLayout]),
      stage(radiance, 'radianceDown', [downLayout]),
    ])
    return {
      traceLayout,
      surroundingsLayout,
      firstLayout,
      downLayout,
      tracePipeline,
      surroundingsPipeline,
      firstPipeline,
      downPipeline,
    }
  }),
)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>

/** The radiance pyramid's levels at `width × height`. */
const radianceLevels = (width: number, height: number) =>
  Math.min(REFLECTION_RADIANCE_LEVELS, mipLevelCountFor(width, height))

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid and its two uniforms; the depth it marches is the Hi-Z's. */
export function reflectionBytes(width: number, height: number) {
  const size: GPUExtent3D = [width, height]
  return (
    textureBytesOf({ size, format: REFLECTION_FORMAT })! +
    textureBytesOf({
      size,
      format: REFLECTION_FORMAT,
      mipLevelCount: radianceLevels(width, height),
    })! +
    REFLECTION_VIEW_BYTES +
    16
  )
}

/**
 * A view's reflection at `width × height`: the target the opaque trace writes, the radiance pyramid
 * of its last lit image, the view uniform — whose surroundings the GPU writes — and the drawn size
 * the pyramid's copy reads, the sampler. `held` is what the
 * pyramid holds: whether it holds an image of this view, and the view-projection and drawn size
 * that image was drawn with — the next image reprojects its hits with them.
 */
export function createScreenReflection(device: GPUDevice, width: number, height: number) {
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  // `COPY_SRC` serves only the proof tools, which reread the target; no frame copies it.
  const target = device.createTexture({
    label: 'Trillion3D reflection',
    size: [width, height],
    format: REFLECTION_FORMAT,
    usage: usage | GPUTextureUsage.COPY_SRC,
  })
  const levels = radianceLevels(width, height)
  const radiance = device.createTexture({
    label: 'Trillion3D reflection radiance',
    size: [width, height],
    format: REFLECTION_FORMAT,
    mipLevelCount: levels,
    usage,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection view',
    size: REFLECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const drawn = device.createBuffer({
    label: 'Trillion3D reflection drawn size',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const sampler = device.createSampler({
    label: 'Trillion3D reflection radiance',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  })
  const level = (at: number) => radiance.createView({ baseMipLevel: at, mipLevelCount: 1 })
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    radianceView: radiance.createView(),
    /** Each level of the pyramid alone, which its build writes then reads. */
    radianceLevels: Array.from({ length: levels }, (_, at) => level(at)),
    levels,
    uniform,
    drawn,
    sampler,
    /** The view uniform's words the CPU writes, each image. */
    words: new Float32Array(REFLECTION_VIEW_WRITTEN_BYTES / 4),
    drawnWords: new Uint32Array(4),
    held: {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0] as [number, number],
      /** Whether the image before it was drawn with the same view-projection: an image traced on
       *  it reads the view it is drawn from (`reflectionsSettled`). */
      still: false,
    },
    /** The reflection group over each Hi-Z pyramid it was bound with (a view's). */
    groups: new WeakMap<GPUTexture, GPUBindGroup>(),
    /** The trace's and the surroundings' groups, kept while their surfaces, light buffer and target
     *  stay. */
    trace: undefined as
      | { surfaces: unknown; lights: GPUBuffer; group: GPUBindGroup; surroundings: GPUBindGroup }
      | undefined,
    /** The pyramid build's groups, kept while the lit image stays. */
    build: undefined as { hdr: GPUTextureView; groups: GPUBindGroup[] } | undefined,
    dispose() {
      target.destroy()
      radiance.destroy()
      uniform.destroy()
      drawn.destroy()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), made
 *  once a pyramid. */
export function reflectionGroup(reflection: ScreenReflection, depth: HizDepth) {
  const kept = reflection.groups.get(depth.pyramid)
  if (kept) return kept
  const { device } = reflection
  const group = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: 0, resource: { buffer: reflection.uniform } },
      { binding: 1, resource: reflection.radianceView },
      { binding: 2, resource: reflection.sampler },
      ...depth.resources.map((resource, k) => ({
        binding: REFLECTION_DEPTH_BINDING + k,
        resource,
      })),
    ],
  })
  reflection.groups.set(depth.pyramid, group)
  return group
}

/** What an image tells its reflection view (`writeReflectionView`). */
export type ReflectionFrame = {
  /** The render view-projection the depth was drawn with, jitter included, and its inverse. */
  viewProjection: ArrayLike<number>
  inverseViewProjection: ArrayLike<number>
  /** The eye, `w` 1, or the view direction, `w` 0, as the lighting reads it. */
  camera: ArrayLike<number>
  /** The drawn size. */
  size: readonly [number, number]
  /** Whether the depth pyramid holds this image's whole depth. */
  depthDrawn: boolean
  /** The background as the display shows it, in linear, the exposure and the display curve's
   *  rank: what the surroundings are made from (`SURROUNDINGS_SHADER`). */
  display: { background: readonly [number, number, number]; exposure: number; curve: number }
}

/**
 * The view uniform of this image: its matrices, the eye, the drawn size and the world size of a
 * pixel at a unit clip `w` — 2 / (height · |row y of the view-projection|), the projection's
 * vertical scale —, the radiance image's view-projection, drawn size and top level, whether the
 * screen is traced — the depth pyramid holds this image's depth and the radiance pyramid an image
 * of this view —, the display curve's rank, the background displayed and the exposure; all but the
 * surroundings, which the GPU writes from them. Nothing in it is a frame index or a seed: a still
 * view writes the same words.
 */
export function writeReflectionView(reflection: ScreenReflection, frame: ReflectionFrame) {
  const { words, held } = reflection
  const counts = new Uint32Array(words.buffer, 60 * 4, 4)
  const m = frame.viewProjection
  for (let i = 0; i < 16; i++) {
    words[i] = m[i]
    words[16 + i] = frame.inverseViewProjection[i]
    words[32 + i] = held.viewProjection[i]
  }
  for (let i = 0; i < 4; i++) words[48 + i] = frame.camera[i]
  const [width, height] = frame.size
  words[52] = width
  words[53] = height
  words[54] = 2 / (height * length3(m[1], m[5], m[9]))
  words[55] = 0
  words[56] = held.size[0]
  words[57] = held.size[1]
  words[58] = reflection.levels - 1
  words[59] = 0
  counts[0] = frame.depthDrawn && held.valid ? 1 : 0
  counts[1] = frame.display.curve
  counts[2] = counts[3] = 0
  words.set(frame.display.background, 64)
  words[67] = frame.display.exposure
  reflection.device.queue.writeBuffer(reflection.uniform, 0, words)
}

/** The surroundings, then the opaque trace, one dispatch a pixel of the drawn size, in the open
 *  compute `pass`. */
export function encodeReflectionTrace(
  pass: GPUComputePassEncoder,
  reflection: ScreenReflection,
  pipelines: ReflectionPipelines,
  inputs: {
    flags: GPUTextureView
    normals: GPUTextureView
    lobes: GPUTextureView
    surfaces: unknown
    lights: GPUBuffer
  },
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
) {
  let kept = reflection.trace
  const { device } = reflection
  if (!kept || kept.surfaces !== inputs.surfaces || kept.lights !== inputs.lights)
    kept = reflection.trace = {
      surfaces: inputs.surfaces,
      lights: inputs.lights,
      group: device.createBindGroup({
        layout: pipelines.traceLayout,
        entries: [
          { binding: 0, resource: inputs.flags },
          { binding: 1, resource: inputs.normals },
          { binding: 2, resource: reflection.targetView },
          { binding: 3, resource: { buffer: inputs.lights } },
          { binding: 4, resource: inputs.lobes },
        ],
      }),
      surroundings: device.createBindGroup({
        layout: pipelines.surroundingsLayout,
        entries: [
          { binding: 0, resource: { buffer: inputs.lights } },
          { binding: 1, resource: { buffer: reflection.uniform } },
        ],
      }),
    }
  pass.setPipeline(pipelines.surroundingsPipeline)
  pass.setBindGroup(0, kept.surroundings)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(pipelines.tracePipeline)
  pass.setBindGroup(0, kept.group)
  pass.setBindGroup(1, depthGroup)
  pass.dispatchWorkgroups(ceilDiv(size[0], SIDE), ceilDiv(size[1], SIDE))
}

/**
 * The radiance pyramid of the lit image `hdr`, drawn at `size` with `viewProjection`, in the open
 * compute `pass`: level 0 and 1 from the image, then each further level; what the pyramid holds is
 * then that image, for the next one's reflections. A pyramid of one level holds nothing.
 */
export function encodeRadiancePyramid(
  pass: GPUComputePassEncoder,
  reflection: ScreenReflection,
  pipelines: ReflectionPipelines,
  hdr: GPUTextureView,
  size: readonly [number, number],
  viewProjection: ArrayLike<number>,
) {
  const { levels, radianceLevels: views, device, held } = reflection
  if (levels < 2) return
  if (reflection.build?.hdr !== hdr) {
    const groups = [
      device.createBindGroup({
        layout: pipelines.firstLayout,
        entries: [
          { binding: 0, resource: hdr },
          { binding: 1, resource: views[1] },
          { binding: 2, resource: views[0] },
          { binding: 3, resource: { buffer: reflection.drawn } },
        ],
      }),
    ]
    for (let at = 2; at < levels; at++)
      groups.push(
        device.createBindGroup({
          layout: pipelines.downLayout,
          entries: [
            { binding: 0, resource: views[at - 1] },
            { binding: 1, resource: views[at] },
          ],
        }),
      )
    reflection.build = { hdr, groups }
  }
  if (reflection.drawnWords[0] !== size[0] || reflection.drawnWords[1] !== size[1]) {
    reflection.drawnWords[0] = size[0]
    reflection.drawnWords[1] = size[1]
    device.queue.writeBuffer(reflection.drawn, 0, reflection.drawnWords)
  }
  const { width, height } = reflection.radiance
  reflection.build.groups.forEach((group, at) => {
    pass.setBindGroup(0, group)
    if (at === 0) {
      pass.setPipeline(pipelines.firstPipeline)
      pass.dispatchWorkgroups(ceilDiv(width, TILE), ceilDiv(height, TILE))
      return
    }
    pass.setPipeline(pipelines.downPipeline)
    pass.dispatchWorkgroups(
      ceilDiv(Math.max(1, width >> (at + 1)), SIDE),
      ceilDiv(Math.max(1, height >> (at + 1)), SIDE),
    )
  })
  let still = held.valid && held.size[0] === size[0] && held.size[1] === size[1]
  for (let i = 0; i < 16 && still; i++) still = held.viewProjection[i] === viewProjection[i]
  held.still = still
  held.valid = true
  copyMatrix4(held.viewProjection, viewProjection)
  held.size[0] = size[0]
  held.size[1] = size[1]
}

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection
 *  over its depth pyramid, both made with the frame's targets and the visibility programs. */
export function bindForwardReflection(
  pass: GPURenderPassEncoder,
  { gpu, vis }: { gpu: { reflection?: ScreenReflection }; vis: { gpuHiz?: GpuHiz } },
) {
  const depth = vis.gpuHiz?.depth()
  if (gpu.reflection && depth)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(gpu.reflection, depth))
}

/**
 * Whether the view's reflections are what a still view shows: the radiance pyramid holds an image
 * of this view, and — when no temporal accumulation turns the projection from image to image, whose
 * own settling covers it — that image was drawn from where the one before it was, so the image
 * traced on it reflects the view as it stands, never the one it moved from. A held image is then
 * final: drawn again, it gives the same bits.
 */
export const reflectionsSettled = (
  reflection: ScreenReflection | undefined,
  accumulating: boolean,
) => !reflection || (reflection.held.valid && (accumulating || reflection.held.still))
