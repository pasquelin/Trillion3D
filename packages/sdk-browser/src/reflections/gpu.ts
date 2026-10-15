import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { createFrontLayer, frontLayerBytes } from './frontLayer.ts'
import { createRadiancePyramid, radianceBytes } from './radiance.ts'
import { SETTLE_BYTES, createRadianceSettle } from './settle.ts'
import { createTraceGroups, type TraceInputs } from './traceGroups.ts'
import type { RadianceInputs } from './radianceBuild.ts'
import { createReflectionGrids, gridBytes } from './grids.ts'
import { createReflectionViewWriter, type ReflectionFrame } from './viewWrite.ts'
import { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import { REFLECTION_PASS, REFLECTION_TRACE_PASS } from '../stage/passLabels.ts'
import { createSurroundings } from '../lighting/toneUnmap.ts'
import { viewProj } from '../webgpu/pages/helpers.ts'
import { REFLECTION_VIEW_BYTES } from './viewLayout.ts'
import { REFLECTION_TARGET } from './weight.ts'

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid — the lit image of the HDR targets' turn about, its level 0, then the levels
 *  after it in the mips of both targets (`radianceBytes`) —, its grids (`gridBytes`), its uniform,
 *  its radiance hash and the transparents' front layer (`frontLayerBytes`, which `blends` sizes); the
 *  depth it marches is the Hi-Z's, the front layer's covering depth folded in. */
export function reflectionBytes(width: number, height: number, blends: boolean) {
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    radianceBytes(width, height) +
    frontLayerBytes(width, height, blends) +
    gridBytes(width, height) +
    REFLECTION_VIEW_BYTES +
    SETTLE_BYTES
  )
}

/**
 * A view's reflection at `width × height`: the target the last pass writes, the radiance pyramid of
 * its last lit image (`radiance`, which holds the image it was made of: the next image reprojects its
 * hits with its view-projection), the grids the trace and its accumulation write
 * (`grids.ts`), the view uniform and its writer, and what each image writes in place.
 * `blends`, whether the scene has any, sizes the transparents' front layer (`createFrontLayer`).
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
    format: HDR_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection view',
    size: REFLECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const radiance = createRadiancePyramid(device, width, height)
  const grids = createReflectionGrids(device, 'Trillion3D reflection grid', [width, height])
  const settle = createRadianceSettle(device)
  const front = createFrontLayer(device, width, height, blends)
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    /** The opaque surface's grids (`grids.ts`). */
    grids,
    uniform,
    settle,
    /** The reflections' turn (`ReflectionView.temporal`) and the lights' epoch the last image was
     *  drawn under — an image under others is drawn for a change (`stageReflectionImage`). */
    turn: 0,
    lightsSeen: NaN,
    /** The transparents' front layer (`frontLayer.ts`): a texel of each target without blends. */
    front,
    writeView: createReflectionViewWriter(device, uniform),
    /** The reflection group over the depth it was bound with (`GpuHiz.depth`), the lit image the
     *  pyramid holds as its level 0 and the lighting's view: two kept, the two HDR targets taking
     *  turns (`reflectionGroup`). */
    group: { identity: createWebgpuBindIdentity(2), slots: [] as (GPUBindGroup | undefined)[] },
    /** The trace's bind groups, every kernel's, kept while their inputs stay
     *  (`encodeReflectionTrace`). */
    trace: createTraceGroups(),
    /** What the image tells its view, what the trace and the radiance build read, and the radiance
     *  a ray leaving the scene reaches (`createSurroundings`): written in place each image. */
    frame: { viewProjection: viewProj, size: [0, 0], depthDrawn: false } as ReflectionFrame,
    inputs: {} as TraceInputs,
    radianceInputs: {} as RadianceInputs,
    surroundings: createSurroundings(),
    /** The Hi-Z nearest build's pass and the trace's, timed alone, each opened lazily. */
    depthPass: new LazyComputePass(REFLECTION_PASS),
    tracePass: new LazyComputePass(REFLECTION_TRACE_PASS),
    dispose() {
      target.destroy()
      radiance.image.texture.destroy()
      grids.destroy()
      uniform.destroy()
      settle.dispose()
      front.dispose()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The image the reflections last reflected shows a scene that is no more: content joined it. The
 *  next image traces nothing and builds the radiance from its own lit image, as a scene opened with
 *  that content draws its first, so the series of images that follows converges to the reflected
 *  image a fresh open's does, whatever the scene was before. */
export function forgetReflectedImage(reflection: ScreenReflection | undefined) {
  if (!reflection) return
  // No image held: the next is drawn for a change (`stageReflectionImage`).
  reflection.radiance.held.valid = false
}

/**
 * Whether the view's reflections are what a still view shows: the radiance pyramid holds an image
 * of this view, and — when no temporal accumulation turns the projection from image to image, whose
 * own settling covers it — that image was drawn from where the one before it was and the reflections
 * are final (`settle.final`): their lit image is the one before it's, and their history is frozen or
 * the trace sampled nothing to accumulate, so the image traced on it reflects the view as it stands,
 * never the one it moved from nor the light it changed. A held image is then final: drawn again, it
 * gives the same bits.
 */
export const reflectionsSettled = (
  reflection: ScreenReflection | undefined,
  accumulating: boolean,
) =>
  !reflection ||
  (reflection.radiance.held.valid &&
    (accumulating || (reflection.radiance.held.still && reflection.settle.final)))
