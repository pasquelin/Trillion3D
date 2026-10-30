import { NEVER_SEEN } from '../../frame/backend/state/previousCamera.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { createProgramGroups } from '../../gpu/bind/programGroups.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { REFLECTION_CENSUS_BYTES, createReflectionCensus } from './census.ts'
import { createFrontLayer, frontLayerBytes } from './frontLayer.ts'
import { createLitImage, litImageBytes } from './litImage.ts'
import { newMeshStageState } from '../bounce/screen/meshStage.ts'
import { createTraceGroups, type TraceInputs } from './trace/traceGroups.ts'
import {
  REFLECTION_DEPTH_FORMAT,
  REFLECTION_GRID_FORMAT,
  createKernelTexture,
  createReflectionGrids,
  depthBytes,
  gridBytes,
  resolvedBytes,
  type ReflectionGrids,
} from './grids.ts'
import { createReflectionViewWriter, type ReflectionFrame } from './viewWrite.ts'
import { createReflectionSettingsReader } from './settings.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { REFLECTION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { viewProj } from '../../frame/backend/helpers.ts'
import { REFLECTION_VIEW_BYTES } from './viewLayout.ts'
import { REFLECTION_TARGET, REFLECTION_TARGET_LAYERS } from './weight.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { VECTOR_FORMAT } from '../../post/taa/velocityWgsl.ts'

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  lit image — the other of the HDR targets that take turns (`litImageBytes`) —, its grids
 *  (`gridBytes`), the resolved pixels both surfaces share (`resolvedBytes`), the depth it keeps of its last image (`depthBytes`), its uniform and the
 *  transparents' front layer (`frontLayerBytes`, which `blends` sizes) and its census (`census.ts`); the
 *  depth it marches is the Hi-Z's, the front layer's covering depth folded in. */
export function reflectionBytes(
  width: number,
  height: number,
  blends: boolean,
  statistics = false,
) {
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    litImageBytes(width, height) +
    frontLayerBytes(width, height, blends) +
    gridBytes(width, height, true) +
    resolvedBytes(width, height) +
    depthBytes(width, height) +
    REFLECTION_VIEW_BYTES +
    (statistics ? REFLECTION_CENSUS_BYTES : 0)
  )
}

/** The target the last pass writes, the view uniform, the resolved pixels the opaque surface's
 *  resolve then the front one's write in turn, in the same pass (`trace/trace.ts`), and the depth the view keeps of its last image. */
function createReflectionTargets(device: GPUDevice, width: number, height: number) {
  // `COPY_SRC` and `COPY_DST` serve only the proof tools, which reread the target and set it first;
  // no frame copies it.
  const target = device.createTexture({
    label: 'Trillion3D reflection',
    size: [width, height, REFLECTION_TARGET_LAYERS],
    format: HDR_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection view',
    size: REFLECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const resolved = createKernelTexture(
    device,
    'Trillion3D reflection resolved',
    [width, height],
    REFLECTION_GRID_FORMAT,
  )
  // The opaque depth of the last image the trace kept (`past.ts`).
  const depth = createKernelTexture(
    device,
    'Trillion3D reflection depth',
    [width, height],
    REFLECTION_DEPTH_FORMAT,
  )
  return { target, uniform, resolved, depth }
}

/** What each image of a reflection writes in place, and the groups it keeps: the reflection group
 *  over the depth it was bound with (`GpuHiz.depth`), the lit image and the lighting's view — two
 *  kept, the two HDR targets taking turns (`reflectionGroup`) —, what the image tells its view, what
 *  the trace reads, and the Hi-Z
 *  full build's pass. */
function reflectionImageState() {
  return {
    group: { identity: createWebgpuBindIdentity(2), slots: [] as (GPUBindGroup | undefined)[] },
    /** The forward programs' group (`forwardReflectionGroup`). */
    forward: createProgramGroups(),
    /** The screen probes' scene stages' group (`reflectionSceneGroup`). */
    scene: createProgramGroups(),
    /** The hit lighting's first pass's group (`reflectionHitGroup`). */
    hit: createProgramGroups(),
    frame: {
      viewProjection: viewProj,
      eye: [0, 0, 0],
      size: [0, 0],
      depthDrawn: false,
    } as ReflectionFrame,
    inputs: {} as TraceInputs,
    /** The Hi-Z full build's pass (the transparents' fold), timed alone, opened lazily. */
    depthPass: new LazyComputePass(REFLECTION_PASS),
  }
}

/** What the reflections keep of the images they staged: the depth image, the lit image's frame, the cut revision, the turn and the count. */
function reflectionImageCounters(depthView: GPUTextureView) {
  return {
    /** The opaque depth of the image the trace last ran on, written after it (`past.ts`), and that image's rank
     *  (`ReflectionFrame.image`; `NEVER_SEEN` for none): the depth of the lit image held, where the two are the same image. */
    depthView,
    depthImage: NEVER_SEEN,
    /** The number of the engine's image (`WebgpuRun.frame`) the lit image held was drawn at, and the view's explicit cut revision the last
     *  image saw (`ReflectionFrame.historyCut`). */
    litFrame: NEVER_SEEN,
    /** The number of the engine's image the view (`ReflectionFrame`) was last staged at: the passes beside the traces read it only for that image. */
    stagedFrame: NEVER_SEEN,
    /** What the image's trace asked of the hit lighting's state (`traceReflections`), folded once at the end of the image (`keepReflectionGrids`): one record the reflection keeps and fills in place, `set` false where the image traced nothing. */
    litAsk: { set: false, grid: [0, 0] as [number, number], vertices: 0 },
    revision: undefined as number | undefined,
    /** The reflections' turn (`ReflectionView.temporal`), advanced every image
     *  (`stageReflectionImage`). */
    turn: 0,
    /** How many images the reflections staged (\`ReflectionFrame.image\`). */
    images: 0,
  }
}

/**
 * A view's reflection at `width × height`: the target the last pass writes, its last lit image
 * (`lit`, which holds what it was drawn with: the next image reprojects its hits with its
 * view-projection), the grids the trace and its accumulation write (`grids.ts`), made
 * by the first image that traces — a view never lit makes none —, the view uniform and its writer,
 * and what each image writes in place. `blends`, whether the scene has any, sizes the transparents'
 * front layer (`createFrontLayer`); the budget counts the grids from the start (`reflectionBytes`).
 */
export function createScreenReflection(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
  statistics = false,
) {
  const { target, uniform, resolved, depth } = createReflectionTargets(device, width, height)
  const lit = createLitImage(device, width, height)
  let grids: ReflectionGrids | undefined
  const front = createFrontLayer(device, width, height, blends)
  const census = createReflectionCensus(device, statistics)
  // What the accumulation reads for the surfaces' vectors where the velocity stage drew none: no
  // surface moves by itself.
  const noVectors = standInTexture(device, 'Trillion3D reflection no vectors', VECTOR_FORMAT)
  return {
    device,
    noVectors: noVectors.createView(),
    target,
    targetView: target.createView(),
    lit,
    /** The opaque surface's grids (`grids.ts`), made when first read, by the first image that traces. */
    get grids() {
      grids ??= createReflectionGrids(device, 'Trillion3D reflection grid', [width, height], true)
      return grids
    },
    /** The resolved pixels both surfaces resolve into in turn (`resolveWgsl.ts`). */
    resolvedView: resolved.createView(),
    uniform,
    ...reflectionImageCounters(depth.createView()),
    /** The transparents' front layer (`frontLayer.ts`): a texel of each target without blends. */
    front,
    writeView: createReflectionViewWriter(device, uniform),
    /** The trace's bind groups, every kernel's, kept while their inputs stay
     *  (`encodeReflectionTrace`). */
    trace: createTraceGroups(device),
    /** What the meshes' fields stage keeps between two images: the grid's resources and the groups made over them (`trace/meshes.ts`). */
    meshes: newMeshStageState(),
    /** The counters the trace's rays add to, read back a few images late (`census.ts`). */
    census,
    /** The reflections' settings of the context, resolved once while none moves (`settings.ts`). */
    settings: createReflectionSettingsReader(),
    ...reflectionImageState(),
    dispose() {
      target.destroy()
      lit.image.texture.destroy()
      grids?.destroy()
      resolved.destroy()
      depth.destroy()
      uniform.destroy()
      front.dispose()
      census.dispose()
      noVectors.destroy()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The image the reflections last reflected shows a scene that is no more: content joined it. The view holds no lit image of itself again, so the next image traces
 *  nothing and starts the denoiser's history from its own resolve, as a scene opened with that content draws its first, and the images that follow are the same bits as a
 *  fresh open's, whatever the scene was before — a history that blends the old scene in settles on rounded values that depend on where it began. */
export function forgetReflectedImage(reflection: ScreenReflection | undefined) {
  if (!reflection) return
  reflection.lit.held.valid = false
}

/**
 * Whether the view's reflections still wait for their first image: the view holds no lit image of
 * itself yet, so no image traced on it reflects the screen. Past it the reflections
 * trace and accumulate every image drawn (no image of the denoiser is ever held): nothing of theirs
 * keeps a view from holding.
 */
export const reflectionsPending = (reflection: ScreenReflection | undefined) =>
  !!reflection && !reflection.lit.held.valid
