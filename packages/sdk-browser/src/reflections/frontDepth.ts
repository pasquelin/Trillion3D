import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'
import { FRONT_DEPTH_PASS } from '../stage/passLabels.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_CONSTANTS_WGSL, REFLECTION_SIDE as SIDE } from './constants.ts'

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
 * surface was written — into a buffer, the box of the pixels it reached kept with it, one atomic a
 * workgroup. The box of this image and that of the last one (`frontBox`) bound what the `folded`
 * texture the readers bind changes by: over them alone, each word is moved into the texture and the
 * buffer left at zero for the next image (`frontFold`, dispatched from the box on the GPU). Outside,
 * the texture already holds the zero the last image left there. For a still view that is the
 * identity. One module owns all of it: the target, the buffer, the boxes, the texture, and whether
 * the scene has blends at all.
 *
 * Why a buffer AND a texture: the scatter's nearest is an atomic `max`, which WebGPU offers on a
 * buffer only; the readers include the blend and water fragment stages, which bind WebGPU's
 * guaranteed 8 storage buffers already (`stageLimits.test.ts`), so they read a texture. A scatter
 * drawn as points into a depth target instead would clamp a depth past the near plane to 1: not the
 * same bits.
 *
 * Cost, for N pixels: with no transparent in view, nothing — no scatter, no fold, the texture is
 * zero and the nearest depth ignores it (`max`): the opaque image keeps its bits. With
 * transparents: the target's 2N bytes written by the blends, the scatter's read of 2 bytes a pixel
 * of the written rectangle and one atomic per surface pixel, the fold's 12 bytes a pixel of the two
 * boxes (a word read and reset, a texel written) — the transparents' own pixels for a still view,
 * never the screen's —, then the nearest build's and the march's reads of 4N bytes — against the
 * radiance pyramid's 8N bytes written. Floor: the blends' own fill, which the target adds 2 bytes a fragment
 * to. A scene with no blend holds a texel of the target and nothing else: the readers bind level 0
 * as the front (`GpuHiz`), whose fold with itself is the opaque depth, bit for bit.
 */
const FRONT_FORMAT: GPUTextureFormat = 'r16float'
/** The format of the depth the readers fold in: the scatter's words, as they are. */
const FOLDED_FORMAT: GPUTextureFormat = 'r32float'
/** Bytes of the scatter's rectangle uniform: its origin, then its end. */
const RECT_BYTES = 16
/** The boxes' words (`frontBox`): this image's destination box (`[x0, y0, x1, y1]`, empty as
 *  `[~0, ~0, 0, 0]`), the last image's, and their union the fold walks. */
const BOX = { now: 0, last: 4, union: 8, words: 12 } as const
/** Bytes of the fold's indirect arguments: its workgroups along x and y, then 1. */
const ARGS_BYTES = 12
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
@group(0) @binding(2) var<storage,read_write> carried:array<atomic<u32>>;
@group(0) @binding(3) var<uniform> frontRect:FrontRect;
@group(0) @binding(4) var<storage,read_write> box:array<atomic<u32>>;
@group(0) @binding(5) var folded:texture_storage_2d<r32float,write>;
var<workgroup> reached:array<atomic<u32>,4>;
/** The pixel of this image the last image's front texel \`texel\` lands on, its depth folded in
 *  there; \`z\` zero where it lands on none. */
fn frontCarry(texel:vec2u)->vec3u{
 let last=vec2u(reflectionView.radiance.xy);
 if(any(texel>=min(last,frontRect.end))){return vec3u(0u);}
 let z=textureLoad(written,texel,0).r;
 if(!(z>0.0)){return vec3u(0u);}
 let size=vec2f(reflectionView.traced.yz);
 let world=unprojectPoint(reflectionView.radianceInverse,vec3f(pixelToNdc(vec2f(texel)+vec2f(0.5),vec2f(last)),z));
 let clip=reflectionView.viewProj*vec4f(world,1.0);
 if(clip.w<=0.0){return vec3u(0u);}
 let at=clipToFramebuffer(clip,size);
 if(any(at.xy<vec2f(0.0))||any(at.xy>=size)||!(at.z>0.0)){return vec3u(0u);}
 let pixel=vec2u(at.xy);
 atomicMax(&carried[pixel.y*reflectionView.traced.w+pixel.x],bitcast<u32>(at.z));
 return vec3u(pixel,1u);
}
@compute @workgroup_size(${SIDE},${SIDE})
fn frontScatter(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  atomicStore(&reached[0],0xffffffffu);atomicStore(&reached[1],0xffffffffu);
  atomicStore(&reached[2],0u);atomicStore(&reached[3],0u);
 }
 workgroupBarrier();
 let pixel=frontCarry(frontRect.origin+id.xy);
 if(pixel.z!=0u){
  atomicMin(&reached[0],pixel.x);atomicMin(&reached[1],pixel.y);
  atomicMax(&reached[2],pixel.x+1u);atomicMax(&reached[3],pixel.y+1u);
 }
 workgroupBarrier();
 // The group's box joins the image's, one atomic a side: none for a group that reached nothing.
 if(lane==0u&&atomicLoad(&reached[2])!=0u){
  atomicMin(&box[${BOX.now}u],atomicLoad(&reached[0]));atomicMin(&box[${BOX.now + 1}u],atomicLoad(&reached[1]));
  atomicMax(&box[${BOX.now + 2}u],atomicLoad(&reached[2]));atomicMax(&box[${BOX.now + 3}u],atomicLoad(&reached[3]));
 }
}
@compute @workgroup_size(${SIDE},${SIDE})
fn frontFold(@builtin(global_invocation_id) id:vec3u){
 let texel=vec2u(atomicLoad(&box[${BOX.union}u]),atomicLoad(&box[${BOX.union + 1}u]))+id.xy;
 if(texel.x>=atomicLoad(&box[${BOX.union + 2}u])||texel.y>=atomicLoad(&box[${BOX.union + 3}u])){return;}
 let at=texel.y*reflectionView.traced.w+texel.x;
 textureStore(folded,texel,vec4f(bitcast<f32>(atomicLoad(&carried[at])),0.0,0.0,0.0));
 atomicStore(&carried[at],0u);
}`,
  [REFLECTION_VIEW_WGSL, pixelToNdc, unprojectPoint, clipToFramebuffer],
)

/** The boxes' one thread (`frontBox`): the union of this image's destination box and the last
 *  image's, which the fold walks, its workgroups the fold's indirect arguments; then this image's box
 *  is the next one's last, and the next image's starts empty. */
export const FRONT_BOX_SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read_write> box:array<u32>;
@group(0) @binding(1) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1)
fn frontBox(){
 let now=vec4u(box[${BOX.now}u],box[${BOX.now + 1}u],box[${BOX.now + 2}u],box[${BOX.now + 3}u]);
 let last=vec4u(box[${BOX.last}u],box[${BOX.last + 1}u],box[${BOX.last + 2}u],box[${BOX.last + 3}u]);
 let low=min(now.xy,last.xy);let high=max(now.zw,last.zw);
 let span=select(vec2u(0u),high-low,all(high>low));
 box[${BOX.union}u]=low.x;box[${BOX.union + 1}u]=low.y;box[${BOX.union + 2}u]=high.x;box[${BOX.union + 3}u]=high.y;
 args[0]=(span.x+${SIDE - 1}u)/${SIDE}u;args[1]=(span.y+${SIDE - 1}u)/${SIDE}u;args[2]=1u;
 box[${BOX.last}u]=now.x;box[${BOX.last + 1}u]=now.y;box[${BOX.last + 2}u]=now.z;box[${BOX.last + 3}u]=now.w;
 box[${BOX.now}u]=0xffffffffu;box[${BOX.now + 1}u]=0xffffffffu;box[${BOX.now + 2}u]=0u;box[${BOX.now + 3}u]=0u;
}`,
  [],
)

/** The scatter's and the fold's layout: the reflection's view, the last image's front depth, the
 *  buffer it folds into, the rectangle the last image's transparents wrote, the boxes and the texture
 *  the readers bind. */
export function frontLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { minBindingSize: REFLECTION_VIEW_BYTES }),
      computeTextureEntry(1, 'unfilterable-float'),
      computeBufferEntry(2, 'storage'),
      computeUniformEntry(3, { minBindingSize: RECT_BYTES }),
      computeBufferEntry(4, 'storage'),
      {
        binding: 5,
        visibility: COMPUTE,
        storageTexture: { access: 'write-only', format: FOLDED_FORMAT },
      },
    ],
  })
}

/** The boxes' layout (`FRONT_BOX_SHADER`): the boxes and the fold's indirect arguments. */
export function frontBoxLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    entries: [computeBufferEntry(0, 'storage'), computeBufferEntry(1, 'storage')],
  })
}

/** Words of a row of the buffer the scatter writes: `width` words, the fold reading it word for
 *  texel. */
export const frontPitch = (width: number) => width

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
      usage: GPUBufferUsage.STORAGE,
    },
    box: {
      label: LABEL,
      size: BOX.words * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    },
    args: {
      label: LABEL,
      size: ARGS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    },
    rect: {
      label: LABEL,
      size: RECT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    },
    // `COPY_SRC` and `COPY_DST` serve only the proof tools, which reread it and write it.
    folded: {
      label: LABEL,
      size,
      format: FOLDED_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    },
  } satisfies Record<string, GPUBufferDescriptor | GPUTextureDescriptor>
  return { written, carried }
}

/** Bytes of the front depth of a view at `width × height` (`frontDescriptors`). */
export function frontBytes(width: number, height: number, blends: boolean) {
  const { written, carried } = frontDescriptors(width, height, blends)
  return (
    textureBytesOf(written)! +
    (carried
      ? carried.buffer.size +
        carried.rect.size +
        carried.box.size +
        carried.args.size +
        textureBytesOf(carried.folded)!
      : 0)
  )
}

/** The boxes as a view's front depth starts them: this image's and the last one's empty. */
const EMPTY_BOXES = Uint32Array.of(~0 >>> 0, ~0 >>> 0, 0, 0, ~0 >>> 0, ~0 >>> 0, 0, 0, 0, 0, 0, 0)

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
    box: device.createBuffer(descriptors.carried.box),
    args: device.createBuffer(descriptors.carried.args),
    folded: device.createTexture(descriptors.carried.folded),
  }
  // Both boxes start empty: no image reached a pixel yet.
  if (carried) device.queue.writeBuffer(carried.box, 0, EMPTY_BOXES)
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
    /** The rectangle the scatter's uniform holds. */
    sent: new Uint32Array(4),
    carried,
    foldedView: carried?.folded.createView(),
    fresh: false,
    held: false,
    group: undefined as GPUBindGroup | undefined,
    boxGroup: undefined as GPUBindGroup | undefined,
    dispose() {
      written.destroy()
      carried?.buffer.destroy()
      carried?.rect.destroy()
      carried?.box.destroy()
      carried?.args.destroy()
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
 * there is one, before the image's reflections, in one compute pass: the scatter over the rectangle
 * they wrote, then the boxes (`frontBox`) and the fold over this image's and the last one's
 * destination boxes (`frontFold`), which moves the carried words into the `folded` texture and
 * leaves the buffer at zero. A texture that held a depth is cleared by the image after, once: its
 * box is the last one there.
 */
export function encodeFrontDepth(
  encoder: GPUCommandEncoder,
  reflection: Pick<ScreenReflection, 'device' | 'uniform' | 'front' | 'radiance'>,
  stages: Pick<
    ReflectionPipelines,
    'frontLayout' | 'frontPipeline' | 'frontFoldPipeline' | 'frontBoxLayout' | 'frontBoxPipeline'
  >,
) {
  const { front, device } = reflection,
    { carried } = front
  const carries = front.fresh
  if (!carried || (!carries && !front.held)) return
  front.group ??= device.createBindGroup({
    label: LABEL,
    layout: stages.frontLayout,
    entries: [
      { binding: 0, resource: { buffer: reflection.uniform } },
      { binding: 1, resource: front.view },
      { binding: 2, resource: { buffer: carried.buffer } },
      { binding: 3, resource: { buffer: carried.rect } },
      { binding: 4, resource: { buffer: carried.box } },
      { binding: 5, resource: front.foldedView! },
    ],
  })
  front.boxGroup ??= device.createBindGroup({
    label: LABEL,
    layout: stages.frontBoxLayout,
    entries: [
      { binding: 0, resource: { buffer: carried.box } },
      { binding: 1, resource: { buffer: carried.args } },
    ],
  })
  const pass = encoder.beginComputePass({ label: FRONT_DEPTH_PASS })
  if (carries) {
    const [width, height] = reflection.radiance.held.size,
      { rect, sent } = front
    const x0 = min(rect[0], width),
      y0 = min(rect[1], height),
      x1 = min(rect[2], width),
      y1 = min(rect[3], height)
    if (sent[0] !== x0 || sent[1] !== y0 || sent[2] !== x1 || sent[3] !== y1) {
      sent[0] = x0
      sent[1] = y0
      sent[2] = x1
      sent[3] = y1
      device.queue.writeBuffer(carried.rect, 0, sent)
    }
    if (x1 > x0 && y1 > y0) {
      pass.setPipeline(stages.frontPipeline)
      pass.setBindGroup(0, front.group)
      pass.dispatchWorkgroups(ceilDiv(x1 - x0, SIDE), ceilDiv(y1 - y0, SIDE))
    }
  }
  pass.setPipeline(stages.frontBoxPipeline)
  pass.setBindGroup(0, front.boxGroup)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(stages.frontFoldPipeline)
  pass.setBindGroup(0, front.group)
  pass.dispatchWorkgroupsIndirect(carried.args, 0)
  pass.end()
  front.held = carries
  front.fresh = false
}
