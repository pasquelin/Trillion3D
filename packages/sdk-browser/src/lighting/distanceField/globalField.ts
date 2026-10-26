import { numClipmaps } from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { CONTROL } from './clipmapBlock.ts'
import { createGlobalGroups, type GlobalGroups } from './globalGroups.ts'
import type { GlobalPipelines } from './globalPipelines.ts'
import { createGlobalResources, resourceShape, type GlobalResources } from './globalResources.ts'
import { encodeGlobalUpdate } from './globalUpdate.ts'
import { GDF_VIEW } from './globalReadWgsl.ts'
import type { MeshFieldState } from './meshFieldScene.ts'
import { CACHE_FULL, CACHE_STATIC } from './objectTracker.ts'
import type { Vec3 } from './regionBounds.ts'
import {
  createRegionState,
  endFrame,
  planRegions,
  type RegionPlan,
  type RegionState,
} from './updateRegions.ts'
import {
  globalReadGroupEntries,
  writeGdfView,
  type AtlasLayout,
  type ReadResources,
} from './view.ts'

/**
 * THE GLOBAL DISTANCE FIELD OF A VIEW, from the meshes' fields in the scene: its resources, made when
 * the settings give them a new shape, its plan of the clipmaps from frame to frame
 * (`updateRegions.ts`), the update encoded each frame (`globalUpdate.ts`), and the view block the
 * programs that read it are given (`view.ts`). The field is kept only while the setting is on and the
 * scene holds a placement with a mesh distance field; otherwise its resources are freed and the view
 * block answers as a scene with no distance field does. The resources a program binds change when
 * the field's shape does: `generation` says so.
 */

/** What a frame is updated for. */
export interface GlobalFieldFrame {
  /** The camera, centimetres. */
  readonly origin: Vec3
  readonly frame: number
  /** Seconds since the frame before. */
  readonly delta: number
  /** The sky light's occlusion distance for the global field, centimetres. */
  readonly occlusionDistance: number
  /** Whether rays are marched through the field this frame: its pages keep a coverage atlas, flagged where only
   *  two-sided meshes reach them (`coverageWgsl.ts`). */
  readonly traced: boolean
  /** Whether a pass reads the field's object grid this frame (`objectGridWgsl.ts`): its pages keep one. */
  readonly grid: boolean
}

const FLAG_BYTES = 6 * 4
/** The atlas of a view that holds no clipmap, which nothing reads. */
const NO_ATLAS: AtlasLayout = { textured: false, coverageBase: 0 }

/** What the global field keeps from frame to frame. */
interface FieldState {
  readonly device: GPUDevice
  readonly pipelines: GlobalPipelines
  readonly viewBuffer: GPUBuffer
  readonly viewWords: Float32Array<ArrayBuffer>
  readonly ring: ReturnType<typeof createReadbackRing>
  region: RegionState
  token: object
  res: GlobalResources | undefined
  groups: GlobalGroups | undefined
  generation: number
  flags: Uint32Array | undefined
  forcedOnceBefore: boolean
}

/** Frees the resources and forgets the field: the next time it is wanted it is composited whole. */
function release(state: FieldState) {
  const { res } = state
  if (!res) return
  retire(state.device, { destroy: () => res.dispose() })
  state.res = state.groups = undefined
  state.region = createRegionState()
  state.token = {}
  state.generation++
}

/** The meshes still to be streamed in that a clipmap was composited without, read back. */
function takeStreamingFlags(state: FieldState) {
  const { region } = state
  state.flags?.forEach((flag, clipmap) => {
    if (flag && !region.deferred[CACHE_STATIC].includes(clipmap))
      region.deferred[CACHE_STATIC].push(clipmap)
  })
  state.flags = undefined
}

/** The resources of the settings' shape and the groups over them; whether the resources are new. */
function ensure(
  state: FieldState,
  settings: GlobalDistanceFieldSettings,
  mesh: MeshFieldState,
  traced: boolean,
  grid: boolean,
) {
  const { device } = state
  let fresh = false
  if (!state.res || state.res.shape !== resourceShape(settings, traced, grid)) {
    const old = state.res
    if (old) retire(device, { destroy: () => old.dispose() })
    state.res = createGlobalResources(device, settings, traced, grid)
    fresh = true
    state.generation++
  }
  const res = state.res
  const stride = res.objectStride
  res.ensureObjects(mesh.objects)
  if (fresh || stride !== res.objectStride || !state.groups)
    state.groups = createGlobalGroups(device, state.pipelines, res)
  return fresh
}

/** The plan of the clipmaps for `frame`. */
function planFrame(
  state: FieldState,
  mesh: MeshFieldState,
  frame: GlobalFieldFrame,
  settings: GlobalDistanceFieldSettings,
  clipmaps: number,
  reallocated: boolean,
) {
  const { region } = state
  if (settings.globalDistanceFieldForceUpdateOnce && !state.forcedOnceBefore)
    region.forcedOnce = true
  state.forcedOnceBefore = settings.globalDistanceFieldForceUpdateOnce
  return planRegions(region, {
    settings,
    clipmaps,
    origin: frame.origin,
    frame: frame.frame,
    delta: frame.delta,
    modified: mesh.modified,
    token: state.token,
    reallocated,
    pendingStreaming: mesh.pendingStreaming,
  })
}

/** Encodes the update `plan` plans on `encoder`, the streaming flags copied to a staging buffer
 *  of the ring when the settings recache on streaming. */
function encodeFrame(
  state: FieldState,
  encoder: GPUCommandEncoder,
  mesh: MeshFieldState,
  frame: GlobalFieldFrame,
  settings: GlobalDistanceFieldSettings,
  plan: RegionPlan,
) {
  const { ring } = state
  const staging =
    settings.globalDistanceFieldRecacheOnStreaming && ring.available() ? ring.take() : undefined
  let copied = false
  const encoded = encodeGlobalUpdate(encoder, {
    device: state.device,
    res: state.res!,
    pipelines: state.pipelines,
    groups: state.groups!,
    scene: mesh.group,
    settings,
    plan,
    origin: frame.origin,
    objects: mesh.objects,
    watch: !!staging,
    traced: frame.traced,
    grid: frame.grid,
    afterStatic: (e) => {
      if (!staging) return
      e.copyBufferToBuffer(state.res!.control, CONTROL.pending * 4, staging, 0, FLAG_BYTES)
      copied = true
    },
  })
  if (staging && !copied) ring.dropped(staging)
  return encoded
}

/** Updates the field for `frame` on `encoder`: planned, encoded and its view block written. */
function updateField(
  state: FieldState,
  encoder: GPUCommandEncoder,
  mesh: MeshFieldState,
  frame: GlobalFieldFrame,
  settings: GlobalDistanceFieldSettings,
) {
  const { device, pipelines, viewWords, viewBuffer } = state
  const clipmaps = numClipmaps(settings)
  if (!settings.globalDistanceField || mesh.objects === 0 || clipmaps === 0) {
    release(state)
    writeGdfView(viewWords, 0, settings, [], frame.origin, 0, NO_ATLAS)
    device.queue.writeBuffer(viewBuffer, 0, viewWords)
    return
  }
  if (frame.grid) pipelines.wantObjectGrid()
  if (!pipelines.ready) return
  const reallocated = ensure(state, settings, mesh, frame.traced, frame.grid)
  takeStreamingFlags(state)
  const plan = planFrame(state, mesh, frame, settings, clipmaps, reallocated)
  const encoded = encodeFrame(state, encoder, mesh, frame, settings, plan)
  endFrame(state.region, frame.frame, encoded)
  writeGdfView(
    viewWords,
    0,
    settings,
    plan.caches[CACHE_FULL],
    frame.origin,
    frame.occlusionDistance,
    state.res!,
  )
  device.queue.writeBuffer(viewBuffer, 0, viewWords)
}

/** The uniform buffer of the view block. */
const createViewBuffer = (device: GPUDevice) =>
  device.createBuffer({
    label: 'Trillion3D global distance field view',
    size: GDF_VIEW.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

/** The global field over `pipelines`, its view block written each frame. */
export function createGlobalField(device: GPUDevice, pipelines: GlobalPipelines) {
  const viewBuffer = createViewBuffer(device)
  const state: FieldState = {
    device,
    pipelines,
    viewBuffer,
    viewWords: new Float32Array(GDF_VIEW.words),
    ring: createReadbackRing(
      device,
      { label: 'Trillion3D global distance field streaming flags', bytes: FLAG_BYTES, count: 4 },
      (mapped) => {
        state.flags = new Uint32Array(mapped.slice(0, FLAG_BYTES))
      },
    ),
    region: createRegionState(),
    token: {},
    res: undefined,
    groups: undefined,
    generation: 0,
    flags: undefined,
    forcedOnceBefore: false,
  }

  return {
    viewBuffer,
    /** Changes whenever the resources the programs bind were made again. */
    get generation() {
      return state.generation
    },
    get resources() {
      return state.res
    },
    /**
     * Updates the field for the frame `frame` on `encoder`: planned, encoded and its view block
     * written. `mesh` is the meshes' scene as the frame left it. Nothing is encoded while the field
     * is off or its pipelines are compiling.
     */
    update(
      encoder: GPUCommandEncoder,
      mesh: MeshFieldState,
      frame: GlobalFieldFrame,
      settings: GlobalDistanceFieldSettings,
    ) {
      updateField(state, encoder, mesh, frame, settings)
    },
    /** The bind group entries of the reads from `first`, over the resources now, none while off. */
    readEntries: (first: number, none: ReadResources) =>
      globalReadGroupEntries(first, { buffer: viewBuffer }, state.res ?? none),
    /** After `queue.submit` of the frame's encoder: the flags copied map. */
    submitted: () => state.ring.submitted(),
    dispose() {
      release(state)
      state.ring.destroy()
      viewBuffer.destroy()
    },
  }
}
