import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthBindEntries } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import { createFrontDepth, frontBytes } from './frontDepth.ts'
import { createRadiancePyramid, radianceBytes } from './radiance.ts'
import { SETTLE_BYTES, createRadianceSettle } from './settle.ts'
import { createTraceGroups } from './trace.ts'
import { createTraceTiles, TRACE_ARGS_BYTES, traceListBytes } from './traceTiles.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import { createProxyStore, proxyStoreBytes } from './proxyStore.ts'
import {
  REFLECTION_DEPTH_BINDING,
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
 *  after it in the mips of both targets (`radianceBytes`) —, its tile list, its uniform, its radiance
 *  hash, the front depth (`frontBytes`, which `blends` sizes) and, while a placement wears a proxy
 *  (`store`), the run-time proxy's answers (`proxyStore.ts`), with the transparents' front layer where
 *  it has `blends`; the depth it marches is the Hi-Z's, its front depth folded in. */
export function reflectionBytes(width: number, height: number, blends: boolean, store = false) {
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    radianceBytes(width, height) +
    frontBytes(width, height, blends) +
    traceListBytes(width, height) +
    TRACE_ARGS_BYTES +
    REFLECTION_VIEW_BYTES +
    SETTLE_BYTES +
    (store ? proxyStoreBytes(width, height, blends) : 0)
  )
}

/**
 * A view's reflection at `width × height`: the target the opaque trace writes, the radiance
 * pyramid of its last lit image (`radiance`, which holds the image it was made of: the next image
 * reprojects its hits with its view-projection), the tile list of the trace, the view uniform and
 * its writer. `blends`, whether the scene has any, sizes the front depth (`createFrontDepth`);
 * `store`, whether a placement wears a proxy, makes the store of its answers (`createProxyStore`).
 */
export function createScreenReflection(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
  store = false,
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
  const tiles = createTraceTiles(device, width, height)
  const settle = createRadianceSettle(device)
  const front = createFrontDepth(device, width, height, blends)
  const answers = createProxyStore(device, width, height, store, blends)
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    tiles,
    uniform,
    settle,
    /** The run-time proxy's answers, kept from image to image (`proxyStore.ts`). */
    store: answers,
    front,
    writeView: createReflectionViewWriter(device, uniform),
    /** The reflection group over the depth it was bound with (`GpuHiz.depth`), the lit image the
     *  pyramid holds as its level 0 and the lighting's view: two kept, the two HDR targets taking
     *  turns (`reflectionGroup`). */
    group: {
      identity: createWebgpuBindIdentity(2),
      slots: [] as (GPUBindGroup | undefined)[],
    },
    /** The trace's bind groups, kept while its inputs stay (`encodeReflectionTrace`). */
    trace: createTraceGroups(),
    dispose() {
      target.destroy()
      radiance.image.texture.destroy()
      tiles.args.destroy()
      tiles.list.destroy()
      uniform.destroy()
      settle.dispose()
      answers.dispose()
      front.dispose()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), the lit
 *  image its pyramid holds now and the lighting's view `lightView`, made again when one of them is
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
