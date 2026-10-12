import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'
import { FRONT_DEPTH_PASS } from '../stage/passLabels.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { clipToFramebuffer, pixelToNdc, unprojectPoint } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_CONSTANTS_WGSL, REFLECTION_SIDE as SIDE } from './constants.ts'
import type { ReflectionPipelines, ScreenReflection } from './gpu.ts'
import { REFLECTION_VIEW_BYTES, REFLECTION_VIEW_WGSL } from './viewLayout.ts'

/**
 * THE TRANSPARENTS' FRONT DEPTH: what lets the one reflection chain meet a blended surface. A ray
 * marches the depth pyramid, which holds the opaque surfaces; the nearest transparent surface of a
 * pixel joins that depth (`Pyramid.front`, folded in by the nearest build, `hizFrontAt`), so that
 * the same march, the same pyramid and the same radiance — the lit image with its transparents,
 * which the radiance pyramid already reads — answer a pane as they answer a wall. No second pass,
 * march or pyramid.
 *
 * The blend pass writes it as one more colour target, `FRONT_FORMAT`: a fragment that covers its
 * pixel (`REFLECTION_FRONT_COVERAGE`) writes its depth, the target's `max` blend keeps the nearest
 * whatever the order of the draws. A target write is no memory write of the fragment stage: the
 * early rejection of hidden blends stays (`earlyRejection.test.ts`). The depth is written a
 * half-float's step behind the surface, never in front of it, so that a ray leaving the surface
 * cannot meet its own pixel's depth.
 *
 * The depth of an image is not known before its blends are drawn, which come after the reflections
 * that read it: the image reads the last one's, carried to its own pixels (`frontScatter`) — each
 * texel unprojected through the last view-projection and projected through this one's, one thread a
 * pixel, an atomic only where a surface was written — into a buffer, copied to the Hi-Z's texture
 * the nearest build folds in. For a still view that is the identity.
 *
 * Cost, for N pixels: with no transparent in view, nothing — no scatter, no clear, the Hi-Z's word
 * is zero and the nearest depth ignores it (`max`): the opaque image keeps its bits. With
 * transparents: the target's 2N bytes written by the blends, a clear of 4N bytes, the scatter's
 * read of 2N bytes and one atomic per surface pixel, a copy of 4N bytes, then the nearest build's
 * and the march's reads of 4N bytes — against the radiance pyramid's 8N bytes written. Floor: the
 * blends' own fill, which the target adds 2 bytes a fragment to.
 */
const FRONT_FORMAT: GPUTextureFormat = 'r16float'

/** The front depth of a fragment that covers `coverage` of its pixel, for the blend's target: its
 *  depth a half-float's step behind, else zero (which the `max` blend ignores). */
export const REFLECTION_FRONT_WGSL = wgslBlock(
  'REFLECTION_FRONT_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `fn reflectionFrontOut(position:vec4f,coverage:f32)->vec4f{
 return vec4f(select(0.0,position.z*(1.0-1.0/1024.0),coverage>=REFLECTION_FRONT_COVERAGE),0.0,0.0,0.0);
}`,
)

/** The target's state in a blend pass: the nearest of the fragments' depths. */
export const FRONT_TARGET: GPUColorTargetState = {
  format: FRONT_FORMAT,
  writeMask: 0x1,
  blend: {
    color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
    alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
  },
}

export const FRONT_SHADER = wgslProgram(
  `@group(0) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(0) @binding(1) var written:texture_2d<f32>;
@group(0) @binding(2) var<storage,read_write> folded:array<atomic<u32>>;
@compute @workgroup_size(${SIDE},${SIDE})
fn frontScatter(@builtin(global_invocation_id) id:vec3u){
 let last=vec2u(reflectionView.radiance.xy);
 if(any(id.xy>=last)){return;}
 let z=textureLoad(written,id.xy,0).r;
 if(!(z>0.0)){return;}
 let size=vec2f(reflectionView.traced.yz);
 let world=unprojectPoint(reflectionView.radianceInverse,vec3f(pixelToNdc(vec2f(id.xy)+vec2f(0.5),vec2f(last)),z));
 let clip=reflectionView.viewProj*vec4f(world,1.0);
 if(clip.w<=0.0){return;}
 let at=clipToFramebuffer(clip,size);
 if(any(at.xy<vec2f(0.0))||any(at.xy>=size)||!(at.z>0.0)){return;}
 let pixel=vec2u(at.xy);
 atomicMax(&folded[pixel.y*reflectionView.traced.w+pixel.x],bitcast<u32>(at.z));
}`,
  [REFLECTION_VIEW_WGSL, pixelToNdc, unprojectPoint, clipToFramebuffer],
)

/** The scatter's layout: the reflection's view, the last image's front depth and the Hi-Z's. */
export function frontLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { minBindingSize: REFLECTION_VIEW_BYTES }),
      computeTextureEntry(1, 'unfilterable-float'),
      computeBufferEntry(2, 'storage'),
    ],
  })
}

/** Words of a row of the buffer the scatter writes: `width` words, padded to the 256 bytes a row of
 *  a copy to a texture takes. */
export const frontPitch = (width: number) => ceilDiv(width * 4, 256) * 64

/** Bytes of the front depth of a view at `width × height`: the blends' target and the scatter's
 *  buffer. */
export const frontBytes = (width: number, height: number) =>
  width * height * 2 + frontPitch(width) * height * 4

/** What a view keeps of the front depth: the target the blends write, the buffer the scatter folds
 *  into, whether the blends wrote the target since it was last carried (`fresh`), whether the
 *  Hi-Z's texture holds a depth to clear (`held`), and the scatter's bind group. */
export function createFrontDepth(device: GPUDevice, width: number, height: number) {
  const written = device.createTexture({
    label: 'Trillion3D reflection front depth',
    size: [width, height],
    format: FRONT_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const folded = device.createBuffer({
    label: 'Trillion3D reflection front depth',
    size: frontPitch(width) * height * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  return {
    written,
    view: written.createView(),
    folded,
    fresh: false,
    held: false,
    group: undefined as GPUBindGroup | undefined,
    dispose() {
      written.destroy()
      folded.destroy()
    },
  }
}
export type FrontDepth = ReturnType<typeof createFrontDepth>

/** The attachment of a blend pass for the front depth: the image's first blend pass clears it. */
export function frontAttachment(front: FrontDepth): GPURenderPassColorAttachment {
  const first = !front.fresh
  front.fresh = true
  return {
    view: front.view,
    loadOp: first ? 'clear' : 'load',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }
}

/**
 * The front depth the blends of the last image wrote, carried to this image's pixels when there is
 * one, before the image's reflections: the buffer cleared, the scatter over the last image's drawn
 * size, and the buffer copied into the Hi-Z's texture `into`, over this image's. A texture that held
 * a depth is cleared by the image after, once.
 */
export function encodeFrontDepth(
  encoder: GPUCommandEncoder,
  reflection: Pick<ScreenReflection, 'device' | 'uniform' | 'front' | 'radiance'>,
  stages: Pick<ReflectionPipelines, 'frontLayout' | 'frontPipeline'>,
  into: GPUTexture,
  size: readonly [number, number],
) {
  const { front, device } = reflection
  const carries = front.fresh
  if (!carries && !front.held) return
  encoder.clearBuffer(front.folded)
  if (carries) {
    front.group ??= device.createBindGroup({
      label: 'Trillion3D reflection front depth',
      layout: stages.frontLayout,
      entries: [
        { binding: 0, resource: { buffer: reflection.uniform } },
        { binding: 1, resource: front.view },
        { binding: 2, resource: { buffer: front.folded } },
      ],
    })
    const [width, height] = reflection.radiance.held.size
    const pass = encoder.beginComputePass({ label: FRONT_DEPTH_PASS })
    pass.setPipeline(stages.frontPipeline)
    pass.setBindGroup(0, front.group)
    pass.dispatchWorkgroups(ceilDiv(width, SIDE), ceilDiv(height, SIDE))
    pass.end()
  }
  encoder.copyBufferToTexture(
    { buffer: front.folded, bytesPerRow: frontPitch(size[0]) * 4 },
    { texture: into },
    size,
  )
  front.held = carries
  front.fresh = false
}
