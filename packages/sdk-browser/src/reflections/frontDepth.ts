import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { FRONT_DEPTH_PASS } from '../stage/passLabels.ts'
import { copyRowBytes } from '../gpu/core/copyRowBytes.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_CONSTANTS_WGSL, REFLECTION_SIDE } from './constants.ts'

const { min, max } = Math
import type { ReflectionPipelines, ScreenReflection } from './gpu.ts'
import { REFLECTION_VIEW_BYTES, REFLECTION_VIEW_WGSL } from './viewLayout.ts'

/**
 * THE TRANSPARENTS' FRONT DEPTH: what lets the one reflection chain meet a blended surface. A ray
 * marches the depth pyramid, which holds the opaque surfaces; the nearest transparent surface of a
 * pixel joins that depth (this module's `folded` texture, which the Hi-Z binds as its front,
 * `GpuHiz.depth`, folded in by the nearest build, `hizFrontAt`), so that the same march, the same
 * pyramid and the same radiance — the lit image with its transparents, which the radiance pyramid
 * already reads — answer a pane as they answer a wall. No second pass, march or pyramid.
 *
 * A transparent surface writes it as one more colour target (`TRANSPARENT_FRONT`), `FRONT_FORMAT`:
 * a fragment that covers its pixel (`REFLECTION_FRONT_COVERAGE`) writes its depth, the target's
 * `max` blend keeps the nearest whatever the order of the draws. A target write is no memory write
 * of the fragment stage: the early rejection of hidden blends stays (`earlyRejection.test.ts`). The
 * depth is written a half-float's step behind the surface, never in front of it, so that a ray
 * leaving the surface cannot meet its own pixel's depth.
 *
 * The depth of an image is not known before its blends are drawn, which come after the reflections
 * that read it: the image reads the last one's, carried to its own pixels (`frontScatter`) — each
 * texel of the rectangle the last image's transparents wrote unprojected through the last
 * view-projection and projected through this one's, one thread a pixel, an atomic only where a
 * surface was written — into a buffer, copied into the `folded` texture the readers bind. For a
 * still view that is the identity. One module owns all of it: the target, the buffer, the texture,
 * the copy, and whether the scene has blends at all.
 *
 * Why a buffer AND a texture: the scatter's nearest is an atomic `max`, which WebGPU offers on a
 * buffer only; the readers include the blend and water fragment stages, which bind WebGPU's
 * guaranteed 8 storage buffers already (`stageLimits.test.ts`), so they read a texture. A scatter
 * drawn as points into a depth target instead would clamp a depth past the near plane to 1: not the
 * same bits.
 *
 * Cost, for N pixels: with no transparent in view, nothing — no scatter, no clear, the texture is
 * zero and the nearest depth ignores it (`max`): the opaque image keeps its bits. With
 * transparents: the target's 2N bytes written by the blends, a clear of 4N bytes, the scatter's
 * read of 2 bytes a pixel of the written rectangle and one atomic per surface pixel, a copy of 4N
 * bytes, then the nearest build's and the march's reads of 4N bytes — against the radiance
 * pyramid's 8N bytes written. Floor: the blends' own fill, which the target adds 2 bytes a fragment
 * to. A scene with no blend holds a texel of the target and nothing else: the readers bind level 0
 * as the front (`GpuHiz`), whose fold with itself is the opaque depth, bit for bit.
 */
const FRONT_FORMAT: GPUTextureFormat = 'r16float'
/** The format of the depth the readers fold in: the scatter's words, as they are. */
const FOLDED_FORMAT: GPUTextureFormat = 'r32float'
/** Bytes of the scatter's rectangle uniform: its origin, then its end. */
const RECT_BYTES = 16
const LABEL = 'Trillion3D reflection front depth'

/** The front depth of a fragment that covers `coverage` of its pixel, for the blend's target: its
 *  depth a half-float's step behind, else zero (which the `max` blend ignores). */
export const REFLECTION_FRONT_WGSL = wgslBlock(
  'REFLECTION_FRONT_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `fn reflectionFrontOut(position:vec4f,coverage:f32)->vec4f{
 return vec4f(select(0.0,position.z*(1.0-1.0/1024.0),coverage>=REFLECTION_FRONT_COVERAGE),0.0,0.0,0.0);
}`,
)

/**
 * The one rule of a transparent surface — a blend, a water surface —: it writes the front depth, as
 * the colour target `target` (the nearest of the fragments' depths) and the fragment output `out`
 * (`reflectionFrontOut`), which every transparent pipeline and its output list take from here.
 */
export const TRANSPARENT_FRONT: { target: GPUColorTargetState; out: [string, string] } = {
  target: {
    format: FRONT_FORMAT,
    writeMask: 0x1,
    blend: {
      color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
      alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
    },
  },
  out: ['front', 'vec4f'],
}

export const FRONT_SHADER = wgslProgram(
  `struct FrontRect{origin:vec2u,end:vec2u,}
@group(0) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(0) @binding(1) var written:texture_2d<f32>;
@group(0) @binding(2) var<storage,read_write> folded:array<atomic<u32>>;
@group(0) @binding(3) var<uniform> frontRect:FrontRect;
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn frontScatter(@builtin(global_invocation_id) id:vec3u){
 let last=vec2u(reflectionView.radiance.xy);
 let texel=frontRect.origin+id.xy;
 if(any(texel>=min(last,frontRect.end))){return;}
 let z=textureLoad(written,texel,0).r;
 if(!(z>0.0)){return;}
 let size=vec2f(reflectionView.traced.yz);
 let world=unprojectPoint(reflectionView.radianceInverse,vec3f(pixelToNdc(vec2f(texel)+vec2f(0.5),vec2f(last)),z));
 let clip=reflectionView.viewProj*vec4f(world,1.0);
 if(clip.w<=0.0){return;}
 let at=clipToFramebuffer(clip,size);
 if(any(at.xy<vec2f(0.0))||any(at.xy>=size)||!(at.z>0.0)){return;}
 let pixel=vec2u(at.xy);
 atomicMax(&folded[pixel.y*reflectionView.traced.w+pixel.x],bitcast<u32>(at.z));
}`,
  [REFLECTION_VIEW_WGSL, pixelToNdc, unprojectPoint, clipToFramebuffer],
)

/** The scatter's layout: the reflection's view, the last image's front depth, the buffer it folds
 *  into and the rectangle the last image's transparents wrote. */
export function frontLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { minBindingSize: REFLECTION_VIEW_BYTES }),
      computeTextureEntry(1, 'unfilterable-float'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(3, { minBindingSize: RECT_BYTES }),
    ],
  })
}

/** Words of a row of the buffer the scatter writes: `width` words, padded to the 256 bytes a row of
 *  a copy to a texture takes. */
export const frontPitch = (width: number) => copyRowBytes(width) / 4

/** What the front depth of a view at `width × height` allocates: the target the transparents write,
 *  and, when the scene has `blends`, the scatter's buffer and uniform and the texture the readers
 *  bind; without, a texel of the target alone. The one source of `createFrontDepth` and
 *  `frontBytes`. */
function frontDescriptors(width: number, height: number, blends: boolean) {
  const size: GPUExtent3D = blends ? [width, height] : [1, 1]
  const written: GPUTextureDescriptor = {
    label: LABEL,
    size,
    format: FRONT_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  }
  if (!blends) return { written }
  const carried = {
    buffer: {
      label: LABEL,
      size: frontPitch(width) * height * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    },
    rect: {
      label: LABEL,
      size: RECT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    },
    // `COPY_SRC` serves only the proof tools, which reread it.
    folded: {
      label: LABEL,
      size,
      format: FOLDED_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    },
  } satisfies Record<string, GPUBufferDescriptor | GPUTextureDescriptor>
  return { written, carried }
}

/** Bytes of the front depth of a view at `width × height` (`frontDescriptors`). */
export function frontBytes(width: number, height: number, blends: boolean) {
  const { written, carried } = frontDescriptors(width, height, blends)
  return (
    textureBytesOf(written)! +
    (carried ? carried.buffer.size + carried.rect.size + textureBytesOf(carried.folded)! : 0)
  )
}

/**
 * What a view keeps of the front depth: the target the transparents write and its one attachment,
 * whether they wrote it since it was last carried (`fresh`) and the rectangle they wrote, and — when
 * the scene has `blends`, laid once when the session opens — what carries it: the buffer the
 * scatter folds into, the texture the readers bind (`foldedView`, whether it holds a depth to
 * clear: `held`), the scatter's rectangle and its bind group. A scene with no blend draws no
 * transparent pass, carries nothing and clears nothing: the target is a texel, and nothing else is
 * made.
 */
export function createFrontDepth(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
) {
  const descriptors = frontDescriptors(width, height, blends)
  const written = device.createTexture(descriptors.written)
  const carried = descriptors.carried && {
    buffer: device.createBuffer(descriptors.carried.buffer),
    rect: device.createBuffer(descriptors.carried.rect),
    folded: device.createTexture(descriptors.carried.folded),
  }
  const view = written.createView()
  /** The attachment every transparent pass takes, made once (`frontAttachment`). */
  const attachment: GPURenderPassColorAttachment = {
    view,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }
  return {
    /** Whether it holds the full target: the scene had a blend when it was made. */
    wanted: blends,
    written,
    view,
    attachment,
    /** The rectangle the transparents wrote since the target was cleared: `[x0, y0, x1, y1]`. */
    rect: [0, 0, 0, 0],
    /** The rectangle the scatter's uniform is given (`writeChanged`). */
    scattered: new Uint32Array(4),
    carried,
    foldedView: carried?.folded.createView(),
    fresh: false,
    held: false,
    /** The scatter's group, under the identity of what it names (`createWebgpuBindIdentity`). */
    scatter: { identity: createWebgpuBindIdentity(), group: undefined as GPUBindGroup | undefined },
    dispose() {
      written.destroy()
      carried?.buffer.destroy()
      carried?.rect.destroy()
      carried?.folded.destroy()
    },
  }
}
export type FrontDepth = ReturnType<typeof createFrontDepth>

/** The attachment of a transparent pass for the front depth, over `rect` (`[x0, y0, x1, y1]`, the
 *  pass's scissor; the whole target without): the image's first such pass clears it. */
export function frontAttachment(front: FrontDepth, rect?: ArrayLike<number>) {
  const first = !front.fresh,
    to = front.rect
  front.fresh = true
  front.attachment.loadOp = first ? 'clear' : 'load'
  const whole = !rect
  for (let k = 0; k < 4; k++) {
    const side = whole ? (k < 2 ? 0 : Infinity) : rect[k]
    to[k] = first ? side : k < 2 ? min(to[k], side) : max(to[k], side)
  }
  return front.attachment
}

/**
 * The front depth the transparents of the last image wrote, carried to this image's pixels when
 * there is one, before the image's reflections: the buffer cleared, the scatter over the rectangle
 * they wrote, and the buffer copied into the `folded` texture, over this image's `size`. A texture
 * that held a depth is cleared by the image after, once.
 */
export function encodeFrontDepth(
  encoder: GPUCommandEncoder,
  reflection: Pick<ScreenReflection, 'device' | 'uniform' | 'front' | 'radiance'>,
  stages: Pick<ReflectionPipelines, 'frontLayout' | 'frontPipeline'>,
  size: readonly [number, number],
) {
  const { front, device } = reflection,
    { carried } = front
  const carries = front.fresh
  if (!carried || (!carries && !front.held)) return
  encoder.clearBuffer(carried.buffer)
  if (carries) {
    const [width, height] = reflection.radiance.held.size,
      { rect, scattered } = front
    const x0 = min(rect[0], width),
      y0 = min(rect[1], height),
      x1 = min(rect[2], width),
      y1 = min(rect[3], height)
    scattered[0] = x0
    scattered[1] = y0
    scattered[2] = x1
    scattered[3] = y1
    writeChanged(device, carried.rect, scattered, 0, 4)
    const { scatter } = front,
      { next } = scatter.identity
    next[0] = stages.frontLayout
    next[1] = reflection.uniform
    next[2] = front.view
    next[3] = carried.buffer
    next[4] = carried.rect
    next.length = 5
    if (scatter.identity.moved() || !scatter.group)
      scatter.group = device.createBindGroup({
        label: LABEL,
        layout: stages.frontLayout,
        entries: sequentialEntries([
          { buffer: reflection.uniform },
          front.view,
          { buffer: carried.buffer },
          { buffer: carried.rect },
        ]),
      })
    if (x1 > x0 && y1 > y0) {
      const pass = encoder.beginComputePass({ label: FRONT_DEPTH_PASS })
      pass.setPipeline(stages.frontPipeline)
      pass.setBindGroup(0, scatter.group)
      pass.dispatchWorkgroups(ceilDiv(x1 - x0, REFLECTION_SIDE), ceilDiv(y1 - y0, REFLECTION_SIDE))
      pass.end()
    }
  }
  encoder.copyBufferToTexture(
    { buffer: carried.buffer, bytesPerRow: frontPitch(size[0]) * 4 },
    { texture: carried.folded },
    size,
  )
  front.held = carries
  front.fresh = false
}
