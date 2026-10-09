import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { validated } from '../gpu/core/errorScope.ts'
import { shaderFailed } from '../gpu/core/shaderModule.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { directLightWgsl } from '../lighting/direct/lightWgsl.ts'
import { mipLevelCountFor } from '../texture/tiles.ts'
import { SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import type { GpuHiz } from '../gpu/hiz/types.ts'
import {
  NEAREST_MIPS_ENTRIES,
  NEAREST_MIPS_SHADER,
  createNearestMips,
  encodeNearestMips,
  nearestMipGroups,
  nearestMipsTexels,
} from './nearestMips.ts'
import { REFLECTION_GROUP, REFLECTION_VIEW_BYTES, reflectedRadianceWgsl } from './wgsl.ts'

/** The reflection target's and the radiance pyramid's format: the lit image's. */
export const REFLECTION_FORMAT: GPUTextureFormat = 'rgba16float'
/** Threads per side of a reflection workgroup: one pixel or one texel each. */
const SIDE = 8
/** The surface flag of a lit standard surface (`../scene/surfaceModel.ts`): the one the opaque
 *  trace marches for; the diffuse and toon models reflect nothing, the background and the unlit
 *  and as-is surfaces neither. */
const LIT_STANDARD_FLAG = 2

/**
 * The opaque surfaces' reflection, one compute pass at full resolution: each pixel of a lit
 * standard surface writes the radiance it reflects (`reflectedRadiance`), every other pixel zero;
 * the opaque resolve weighs it (`resolvedReflectionWgsl`). A pixel past the trace's roughness reads
 * the environment alone, inside the same function.
 */
export const TRACE_SHADER = wgslProgram(
  `@group(0) @binding(0) var traceFlags:texture_2d<u32>;
@group(0) @binding(1) var traceNormals:texture_2d<f32>;
@group(0) @binding(2) var traceOut:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var<storage,read> directLights:DirectLights;
@compute @workgroup_size(${SIDE},${SIDE})
fn traceReflections(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=reflectionView.screen.xy)){return;}
 let coord=vec2i(id.xy);
 var radiance=vec3f(0.0);
 if((textureLoad(traceFlags,coord,0).r&${SURFACE_MODEL_MASK}u)==${LIT_STANDARD_FLAG}u){
  let z=textureLoad(reflectionDepth,coord,0).r;
  let P=reflectionWorldAt(vec2f(id.xy)+vec2f(0.5),z);
  let normal=textureLoad(traceNormals,coord,0);
  let V=normalize(reflectionView.camera.xyz-P*reflectionView.camera.w);
  radiance=reflectedRadiance(P,normalize(normal.xyz),V,normal.a);
 }
 textureStore(traceOut,coord,vec4f(radiance,1.0));
}`,
  [directLightWgsl(), reflectedRadianceWgsl(REFLECTION_GROUP)],
)

/**
 * The radiance pyramid: the lit image of the frame, before the temporal resolve, and its box-filtered
 * mips, which the next image's reflections read at the cone's level. `radianceFirst` copies the drawn
 * image into level 0 — zero past the drawn size — and reduces level 1 from the texels it read;
 * `radianceDown` reduces each further level from the one before. The last texel of an odd size also
 * averages the source's last column or row: every texel counts once in every level. The colour is
 * averaged with its coverage (the lit image's alpha: 1 where a surface drew, 0 on the background),
 * so a cone over a silhouette reads the background's share as uncovered, which the reflection fills
 * with the environment — the depth-aware filter's halo, without a depth read.
 */
export const RADIANCE_SHADER = wgslProgram(
  `@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var coarser:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(2) var copy:texture_storage_2d<${REFLECTION_FORMAT},write>;
@group(0) @binding(3) var<uniform> drawn:vec4u;
fn radianceSpan(id:vec2u,size:vec2u,source:vec2u)->vec4u{
 let low=id*2u;
 return vec4u(low,select(low+1u,source-1u,id==size-1u));
}
@compute @workgroup_size(${SIDE},${SIDE})
fn radianceFirst(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(coarser);
 if(any(id.xy>=size)){return;}
 let span=radianceSpan(id.xy,size,textureDimensions(finer));
 var sum=vec4f(0.0);
 for(var y=span.y;y<=span.w;y++){
  for(var x=span.x;x<=span.z;x++){
   let p=vec2u(x,y);
   var c=vec4f(0.0);
   if(all(p<drawn.xy)){c=textureLoad(finer,p,0);c.a=clamp(c.a,0.0,1.0);}
   textureStore(copy,p,c);
   sum+=c;
  }
 }
 textureStore(coarser,id.xy,sum/f32((span.z-span.x+1u)*(span.w-span.y+1u)));
}
@compute @workgroup_size(${SIDE},${SIDE})
fn radianceDown(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(coarser);
 if(any(id.xy>=size)){return;}
 let span=radianceSpan(id.xy,size,textureDimensions(finer));
 var sum=vec4f(0.0);
 for(var y=span.y;y<=span.w;y++){
  for(var x=span.x;x<=span.z;x++){sum+=textureLoad(finer,vec2u(x,y),0);}
 }
 textureStore(coarser,id.xy,sum/f32((span.z-span.x+1u)*(span.w-span.y+1u)));
}`,
  [],
)

const storage = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: 'write-only', format: REFLECTION_FORMAT },
})

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, the
 *  depth pyramid's level 0 and nearest levels, the radiance pyramid and its sampler, read by
 *  compute and fragment stages. */
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
      { binding: 1, visibility, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility, texture: { sampleType: 'float' } },
      { binding: 4, visibility, sampler: { type: 'filtering' } },
    ],
  })
})

/** The reflection's kernels — the depth's nearest mips, the opaque trace, the radiance pyramid's
 *  two — compiled once a device under one validation scope. */
export const createReflectionPipelines = oncePerDevice((device: GPUDevice) =>
  validated(device, async () => {
    const trace = device.createShaderModule({
      label: 'Trillion3D reflection trace',
      code: TRACE_SHADER,
    })
    const radiance = device.createShaderModule({
      label: 'Trillion3D reflection radiance',
      code: RADIANCE_SHADER,
    })
    const nearest = device.createShaderModule({
      label: 'Trillion3D reflection nearest depth',
      code: NEAREST_MIPS_SHADER,
    })
    for (const module of [trace, radiance, nearest])
      if (await shaderFailed(module)) return undefined
    const nearestLayout = device.createBindGroupLayout({ entries: NEAREST_MIPS_ENTRIES })
    const traceLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: COMPUTE, texture: { sampleType: 'uint' } },
        { binding: 1, visibility: COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        storage(2),
        { binding: 3, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    })
    const finer: GPUBindGroupLayoutEntry = {
      binding: 0,
      visibility: COMPUTE,
      texture: { sampleType: 'unfilterable-float' },
    }
    const firstLayout = device.createBindGroupLayout({
      entries: [
        finer,
        storage(1),
        storage(2),
        { binding: 3, visibility: COMPUTE, buffer: { type: 'uniform' } },
      ],
    })
    const downLayout = device.createBindGroupLayout({ entries: [finer, storage(1)] })
    const stage = (module: GPUShaderModule, entryPoint: string, groups: GPUBindGroupLayout[]) =>
      buildComputePipeline(device, {
        layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
        compute: { module, entryPoint },
      })
    const [tracePipeline, firstPipeline, downPipeline, nearestPipeline] = await Promise.all([
      stage(trace, 'traceReflections', [traceLayout, reflectionLayout(device)]),
      stage(radiance, 'radianceFirst', [firstLayout]),
      stage(radiance, 'radianceDown', [downLayout]),
      stage(nearest, 'nearestMip', [nearestLayout]),
    ])
    return {
      traceLayout,
      firstLayout,
      downLayout,
      nearestLayout,
      tracePipeline,
      firstPipeline,
      downPipeline,
      nearestPipeline,
    }
  }),
)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid, the depth's nearest levels and its two uniforms. */
export function reflectionBytes(width: number, height: number) {
  const size: GPUExtent3D = [width, height]
  return (
    textureBytesOf({ size, format: REFLECTION_FORMAT })! +
    textureBytesOf({
      size,
      format: REFLECTION_FORMAT,
      mipLevelCount: mipLevelCountFor(width, height),
    })! +
    nearestMipsTexels(width, height) * 4 +
    REFLECTION_VIEW_BYTES +
    16
  )
}

/**
 * A view's reflection at `width × height`: the target the opaque trace writes, the radiance pyramid
 * of its last lit image, the view uniform and the drawn size the pyramid's copy reads, the sampler.
 * `held` is what the pyramid holds: whether it holds an image of this view, and the view-projection
 * and drawn size that image was drawn with — the next image reprojects its hits with them.
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
  const levels = mipLevelCountFor(width, height)
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
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
  const nearest = createNearestMips(device, width, height)
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
    /** The depth pyramid's levels 1 and down (`nearestMips.ts`). */
    nearest,
    nearestView: nearest.createView(),
    uniform,
    drawn,
    sampler,
    /** The view uniform's words, written each image. */
    words: new Float32Array(REFLECTION_VIEW_BYTES / 4),
    drawnWords: new Uint32Array(4),
    held: {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0] as [number, number],
      /** Whether the image before it was drawn with the same view-projection: an image traced on
       *  it reads the view it is drawn from (`reflectionsSettled`). */
      still: false,
    },
    /** The reflection group and the nearest mips' build of each Hi-Z level 0 it was bound with
     *  (a view's). */
    groups: new WeakMap<GPUTexture, { group: GPUBindGroup; nearest: GPUBindGroup[] }>(),
    /** The trace's group, kept while its surfaces, light buffer and target stay. */
    trace: undefined as { surfaces: unknown; lights: GPUBuffer; group: GPUBindGroup } | undefined,
    /** The pyramid build's groups, kept while the lit image stays. */
    build: undefined as { hdr: GPUTextureView; groups: GPUBindGroup[] } | undefined,
    dispose() {
      target.destroy()
      radiance.destroy()
      nearest.destroy()
      uniform.destroy()
      drawn.destroy()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The Hi-Z level 0 a reflection reads: a view's pyramid's (`GpuHiz`). */
export type ReflectionDepth = Pick<GpuHiz, 'level0' | 'level0View'>

/** The groups of `reflection` over the Hi-Z level 0 `depth`, made once a level 0: the reflection
 *  group, and the build of its nearest levels from it (`nearestMips.ts`). */
function depthGroups(
  reflection: ScreenReflection,
  pipelines: Pick<ReflectionPipelines, 'nearestLayout'> | undefined,
  depth: ReflectionDepth,
) {
  const kept = reflection.groups.get(depth.level0)
  if (kept && (kept.nearest.length || !pipelines)) return kept
  const { device } = reflection
  const made = {
    group:
      kept?.group ??
      device.createBindGroup({
        label: 'Trillion3D reflection',
        layout: reflectionLayout(device),
        entries: [
          { binding: 0, resource: { buffer: reflection.uniform } },
          { binding: 1, resource: depth.level0View },
          { binding: 2, resource: reflection.nearestView },
          { binding: 3, resource: reflection.radianceView },
          { binding: 4, resource: reflection.sampler },
        ],
      }),
    nearest: pipelines
      ? nearestMipGroups(device, pipelines.nearestLayout, depth.level0View, reflection.nearest)
      : [],
  }
  reflection.groups.set(depth.level0, made)
  return made
}

/** The reflection group of `reflection` over the Hi-Z level 0 `depth` and its nearest levels. */
export const reflectionGroup = (reflection: ScreenReflection, depth: ReflectionDepth) =>
  depthGroups(reflection, undefined, depth).group

/** The nearest levels below `depth`, the image's whole depth, in the open compute `pass`. */
export function encodeReflectionDepth(
  pass: GPUComputePassEncoder,
  reflection: ScreenReflection,
  pipelines: ReflectionPipelines,
  depth: ReflectionDepth,
) {
  const { nearest } = depthGroups(reflection, pipelines, depth)
  encodeNearestMips(pass, pipelines.nearestPipeline, nearest, reflection.nearest)
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
  /** Whether the depth pyramid holds this image's depth. */
  depthDrawn: boolean
}

/**
 * The view uniform of this image: its matrices, the eye, the drawn size and the world size of a
 * pixel at a unit clip `w` — 2 / (height · |row y of the view-projection|), the projection's
 * vertical scale —, the radiance image's view-projection, drawn size and top level, and whether the
 * screen is traced: the depth pyramid holds this image's depth and the radiance pyramid an image of
 * this view. Nothing in it is a frame index or a seed: a still view writes the same words.
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
  counts[1] = counts[2] = counts[3] = 0
  reflection.device.queue.writeBuffer(reflection.uniform, 0, words)
}

/** The opaque trace, one dispatch a pixel of the drawn size in the open compute `pass`. */
export function encodeReflectionTrace(
  pass: GPUComputePassEncoder,
  reflection: ScreenReflection,
  pipelines: ReflectionPipelines,
  inputs: { flags: GPUTextureView; normals: GPUTextureView; surfaces: unknown; lights: GPUBuffer },
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
) {
  let kept = reflection.trace
  if (!kept || kept.surfaces !== inputs.surfaces || kept.lights !== inputs.lights)
    kept = reflection.trace = {
      surfaces: inputs.surfaces,
      lights: inputs.lights,
      group: reflection.device.createBindGroup({
        layout: pipelines.traceLayout,
        entries: [
          { binding: 0, resource: inputs.flags },
          { binding: 1, resource: inputs.normals },
          { binding: 2, resource: reflection.targetView },
          { binding: 3, resource: { buffer: inputs.lights } },
        ],
      }),
    }
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
  const { levels, radianceLevels, device, held } = reflection
  if (levels < 2) return
  if (reflection.build?.hdr !== hdr) {
    const groups = [
      device.createBindGroup({
        layout: pipelines.firstLayout,
        entries: [
          { binding: 0, resource: hdr },
          { binding: 1, resource: radianceLevels[1] },
          { binding: 2, resource: radianceLevels[0] },
          { binding: 3, resource: { buffer: reflection.drawn } },
        ],
      }),
    ]
    for (let at = 2; at < levels; at++)
      groups.push(
        device.createBindGroup({
          layout: pipelines.downLayout,
          entries: [
            { binding: 0, resource: radianceLevels[at - 1] },
            { binding: 1, resource: radianceLevels[at] },
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
    const w = Math.max(1, width >> (at + 1)),
      h = Math.max(1, height >> (at + 1))
    pass.setPipeline(at ? pipelines.downPipeline : pipelines.firstPipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(ceilDiv(w, SIDE), ceilDiv(h, SIDE))
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
  if (gpu.reflection && vis.gpuHiz)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(gpu.reflection, vis.gpuHiz))
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
