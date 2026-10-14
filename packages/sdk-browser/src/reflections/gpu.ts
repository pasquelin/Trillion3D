import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthBindEntries } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import { createFrontLayer, frontLayerBytes } from './frontLayer.ts'
import { createRadiancePyramid, radianceBytes } from './radiance.ts'
import { SETTLE_BYTES, createRadianceSettle } from './settle.ts'
import { createTraceGroups } from './halfEncode.ts'
import { createHalfGrids, halfBytes, halfExtent } from './halfTexture.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_FRONT_BINDING,
  REFLECTION_GROUP,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SAMPLER_BINDING,
  REFLECTION_VIEW_BYTES,
} from './viewLayout.ts'
import { REFLECTION_TARGET } from './weight.ts'
import { reflectionLayout } from './reflectionPipelines.ts'

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid — the lit image of the HDR targets' turn about, its level 0, then the levels
 *  after it in the mips of both targets (`radianceBytes`) —, its half grids (`halfBytes`), its uniform,
 *  its radiance hash and the transparents' front layer (`frontLayerBytes`, which `blends` sizes); the
 *  depth it marches is the Hi-Z's, the front layer's covering depth folded in. */
export function reflectionBytes(width: number, height: number, blends: boolean) {
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    radianceBytes(width, height) +
    frontLayerBytes(width, height, blends) +
    halfBytes(width, height) +
    REFLECTION_VIEW_BYTES +
    SETTLE_BYTES
  )
}

/**
 * A view's reflection at `width × height`: the target the upsample writes, the radiance pyramid of
 * its last lit image (`radiance`, which holds the image it was made of: the next image reprojects its
 * hits with its view-projection), the half grids the trace and its accumulation write
 * (`halfTexture.ts`), the view uniform
 * and its writer. `blends`, whether the scene has any, sizes the transparents' front layer
 * (`createFrontLayer`).
 */
export function createScreenReflection(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
) {
  // `COPY_SRC` and `COPY_DST` serve only the proof tools, which reread the target and set it first;
  // no frame copies it.
  const target = device.createTexture({
    label: 'Trillion3D reflection',
    size: [width, height],
    format: REFLECTION_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection view',
    size: REFLECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const radiance = createRadiancePyramid(device, width, height)
  const half = createHalfGrids(device, 'Trillion3D reflection half grid', halfExtent(width, height))
  const settle = createRadianceSettle(device)
  const front = createFrontLayer(device, width, height, blends)
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    /** The opaque surface's half grids (`halfTexture.ts`). */
    half,
    uniform,
    settle,
    /** The reflections' turn (`ReflectionView.temporal`), and the lights' epoch the last image was drawn
     *  under: an image under others is drawn for a change (`writeFrame`). */
    turn: 0,
    lightsSeen: NaN,
    /** The transparents' front layer (`frontLayer.ts`): a texel of each target without blends. */
    front,
    writeView: createReflectionViewWriter(device, uniform),
    /** The reflection group over the depth it was bound with (`GpuHiz.depth`), the lit image the
     *  pyramid holds as its level 0 and the lighting's view: two kept, the two HDR targets taking
     *  turns (`reflectionGroup`). */
    group: {
      identity: createWebgpuBindIdentity(2),
      slots: [] as (GPUBindGroup | undefined)[],
    },
    /** The trace's and the upsample's bind groups, kept while their inputs stay
     *  (`encodeReflectionTrace`). */
    trace: createTraceGroups(),
    dispose() {
      target.destroy()
      radiance.image.texture.destroy()
      half.destroy()
      uniform.destroy()
      settle.dispose()
      front.dispose()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), the lit
 *  image its pyramid holds now, its front layer's depth and the lighting's view `lightView`, made again when one of them is
 *  not the one it was made over: the two HDR targets taking turns find a group each. */
export function reflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
) {
  const image = reflection.radiance.image.texture,
    { identity, slots } = reflection.group
  identity.next[0] = depth
  identity.next[1] = image
  identity.next[2] = lightView
  identity.next.length = 3
  const moved = identity.moved()
  const kept = slots[identity.slot]
  if (kept && !moved) return kept
  const { device } = reflection
  return (slots[identity.slot] = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: 0, resource: { buffer: reflection.uniform } },
      { binding: REFLECTION_SAMPLER_BINDING, resource: reflection.radiance.sampler },
      ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
      // Every level of the pyramid: the lit image and its mips (`hdrTargetDescriptor`).
      { binding: REFLECTION_IMAGE_BINDING, resource: image.createView() },
      // The transparents' front depth, the front pass's depth itself (`frontLayer.ts`).
      { binding: REFLECTION_FRONT_BINDING, resource: reflection.front.views.depth },
    ],
  }))
}

/** What a frame holds that the reflection reads (`reflectionLightView`). */
export type ReflectionHost = {
  gpu: {
    reflection?: ScreenReflection
    deferred?: { uniform: GPUBuffer }
  }
  vis: { gpuHiz?: GpuHiz }
}

/** The reflection group's other resource: the lighting's view. Undefined while the lighting is not made. */
export const reflectionLightView = ({ gpu }: ReflectionHost) => gpu.deferred?.uniform

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection
 *  over its depth pyramid, both made with the frame's targets and the visibility programs. */
export function bindForwardReflection(pass: GPURenderPassEncoder, rt: ReflectionHost) {
  const depth = rt.vis.gpuHiz?.depth(),
    lightView = reflectionLightView(rt)
  if (rt.gpu.reflection && depth && lightView)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(rt.gpu.reflection, depth, lightView))
}

/** The image the reflections last reflected shows a scene that is no more: content joined it. The
 *  next image traces nothing and builds the radiance from its own lit image, as a scene opened with
 *  that content draws its first, so the images that follow are the same bits as a fresh open's,
 *  whatever the scene was before — the series they converge to starts from the same image. */
export function forgetReflectedImage(reflection: ScreenReflection | undefined) {
  if (!reflection) return
  reflection.radiance.held.valid = false
  reflection.settle.busy()
}

/**
 * Whether the view's reflections are what a still view shows: the radiance pyramid holds an image
 * of this view, and — when no temporal accumulation turns the projection from image to image, whose
 * own settling covers it — that image was drawn from where the one before it was, and its lit
 * image is the one before it's (`settle.verified`), so the image traced on it reflects the view as
 * it stands, never the one it moved from nor the light it changed. A held image is then final:
 * drawn again, it gives the same bits.
 */
export const reflectionsSettled = (
  reflection: ScreenReflection | undefined,
  accumulating: boolean,
) =>
  !reflection ||
  (reflection.radiance.held.valid &&
    (accumulating || (reflection.radiance.held.still && reflection.settle.verified)))
