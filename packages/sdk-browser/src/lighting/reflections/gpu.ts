import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { createFrontLayer, frontLayerBytes } from './frontLayer.ts'
import { createRadiancePyramid, radianceBytes } from './radiance/radiance.ts'
import { createTraceGroups, type TraceInputs } from './trace/traceGroups.ts'
import type { RadianceInputs } from './radiance/radianceBuild.ts'
import {
  REFLECTION_GRID_FORMAT,
  createKernelTexture,
  createReflectionGrids,
  gridBytes,
  resolvedBytes,
} from './grids.ts'
import { createReflectionViewWriter, type ReflectionFrame } from './viewWrite.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { REFLECTION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createSurroundings } from '../toneUnmap.ts'
import { viewProj } from '../../frame/backend/helpers.ts'
import { REFLECTION_VIEW_BYTES } from './viewLayout.ts'
import { REFLECTION_TARGET } from './weight.ts'

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid — the lit image of the HDR targets' turn about, its level 0, then the levels
 *  after it in the mips of both targets (`radianceBytes`) —, its grids (`gridBytes`), the resolved
 *  pixels both surfaces share (`resolvedBytes`), its uniform and the transparents' front layer
 *  (`frontLayerBytes`, which `blends` sizes); the depth it marches is the Hi-Z's, the front layer's
 *  covering depth folded in. */
export function reflectionBytes(width: number, height: number, blends: boolean) {
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    radianceBytes(width, height) +
    frontLayerBytes(width, height, blends) +
    gridBytes(width, height) +
    resolvedBytes(width, height) +
    REFLECTION_VIEW_BYTES
  )
}

/**
 * A view's reflection at `width × height`: the target the last pass writes, the radiance pyramid of
 * its last lit image (`radiance`, which holds the image it was made of: the next image reprojects its
 * hits with its view-projection), the grids the trace and its accumulation write
 * (`grids.ts`), the view uniform and its writer, and what each image writes in place.
 * `blends`, whether the scene has any, sizes the transparents' front layer (`createFrontLayer`);
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
  // The resolved pixels, the opaque surface's then the front one's in the same pass (`trace/trace.ts`).
  const resolved = createKernelTexture(
    device,
    'Trillion3D reflection resolved',
    [width, height],
    REFLECTION_GRID_FORMAT,
  )
  const front = createFrontLayer(device, width, height, blends)
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    /** The opaque surface's grids (`grids.ts`). */
    grids,
    /** The resolved pixels both surfaces resolve into in turn (`resolveWgsl.ts`). */
    resolvedView: resolved.createView(),
    uniform,
    /** The reflections' turn (`ReflectionView.temporal`), advanced every image
     *  (`stageReflectionImage`). */
    turn: 0,
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
    /** The Hi-Z nearest build's pass, timed alone, opened lazily. */
    depthPass: new LazyComputePass(REFLECTION_PASS),
    dispose() {
      target.destroy()
      radiance.image.texture.destroy()
      grids.destroy()
      resolved.destroy()
      uniform.destroy()
      front.dispose()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/**
 * Whether the view's reflections still wait for their first image: the radiance pyramid holds no
 * image of this view yet, so no image traced on it reflects the screen. Past it the reflections
 * trace and accumulate every image drawn (no image of the denoiser is ever held): nothing of theirs
 * keeps a view from holding.
 */
export const reflectionsPending = (reflection: ScreenReflection | undefined) =>
  !!reflection && !reflection.radiance.held.valid
