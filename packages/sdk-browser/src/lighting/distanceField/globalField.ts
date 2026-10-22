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
import { createRegionState, endFrame, planRegions } from './updateRegions.ts'
import { globalReadGroupEntries, writeGdfView, type ReadResources } from './view.ts'

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
}

const FLAG_BYTES = 6 * 4

/** The global field over `pipelines`, its view block written each frame. */
export function createGlobalField(device: GPUDevice, pipelines: GlobalPipelines) {
  const viewBuffer = device.createBuffer({
    label: 'Trillion3D global distance field view',
    size: GDF_VIEW.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const viewWords = new Float32Array(GDF_VIEW.words)
  let region = createRegionState()
  let token = {}
  let res: GlobalResources | undefined
  let groups: GlobalGroups | undefined
  let generation = 0
  let flags: Uint32Array | undefined
  let forcedOnceBefore = false
  const ring = createReadbackRing(
    device,
    { label: 'Trillion3D global distance field streaming flags', bytes: FLAG_BYTES, count: 4 },
    (mapped) => {
      flags = new Uint32Array(mapped.slice(0, FLAG_BYTES))
    },
  )

  /** Frees the resources and forgets the field: the next time it is wanted it is composited whole. */
  function release() {
    if (!res) return
    const old = res
    retire(device, { destroy: () => old.dispose() })
    res = groups = undefined
    region = createRegionState()
    token = {}
    generation++
  }

  /** The meshes still to be streamed in that a clipmap was composited without, read back. */
  function takeStreamingFlags() {
    flags?.forEach((flag, clipmap) => {
      if (flag && !region.deferred[CACHE_STATIC].includes(clipmap))
        region.deferred[CACHE_STATIC].push(clipmap)
    })
    flags = undefined
  }

  /** The resources of the settings' shape and the groups over them; whether the resources are new. */
  function ensure(settings: GlobalDistanceFieldSettings, mesh: MeshFieldState) {
    let fresh = false
    if (!res || res.shape !== resourceShape(settings)) {
      const old = res
      if (old) retire(device, { destroy: () => old.dispose() })
      res = createGlobalResources(device, settings)
      fresh = true
      generation++
    }
    const stride = res.objectStride
    res.ensureObjects(mesh.objects)
    if (fresh || stride !== res.objectStride || !groups)
      groups = createGlobalGroups(device, pipelines, res)
    return fresh
  }

  return {
    viewBuffer,
    /** Changes whenever the resources the programs bind were made again. */
    get generation() {
      return generation
    },
    get resources() {
      return res
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
      const clipmaps = numClipmaps(settings)
      if (!settings.globalDistanceField || mesh.objects === 0 || clipmaps === 0) {
        release()
        writeGdfView(viewWords, 0, settings, [], frame.origin, 0)
        device.queue.writeBuffer(viewBuffer, 0, viewWords)
        return
      }
      if (!pipelines.ready) return
      const reallocated = ensure(settings, mesh)
      takeStreamingFlags()
      if (settings.globalDistanceFieldForceUpdateOnce && !forcedOnceBefore) region.forcedOnce = true
      forcedOnceBefore = settings.globalDistanceFieldForceUpdateOnce
      const plan = planRegions(region, {
        settings,
        clipmaps,
        origin: frame.origin,
        frame: frame.frame,
        delta: frame.delta,
        modified: mesh.modified,
        token,
        reallocated,
        pendingStreaming: mesh.pendingStreaming,
      })
      const staging =
        settings.globalDistanceFieldRecacheOnStreaming && ring.available() ? ring.take() : undefined
      let copied = false
      const encoded = encodeGlobalUpdate(encoder, {
        device,
        res: res!,
        pipelines,
        groups: groups!,
        scene: mesh.group,
        settings,
        plan,
        origin: frame.origin,
        objects: mesh.objects,
        watch: !!staging,
        afterStatic: (e) => {
          if (!staging) return
          e.copyBufferToBuffer(res!.control, CONTROL.pending * 4, staging, 0, FLAG_BYTES)
          copied = true
        },
      })
      if (staging && !copied) ring.dropped(staging)
      endFrame(region, frame.frame, encoded)
      writeGdfView(
        viewWords,
        0,
        settings,
        plan.caches[CACHE_FULL],
        frame.origin,
        frame.occlusionDistance,
      )
      device.queue.writeBuffer(viewBuffer, 0, viewWords)
    },
    /** The bind group entries of the reads from `first`, over the resources now, none while off. */
    readEntries: (first: number, none: ReadResources) =>
      globalReadGroupEntries(first, { buffer: viewBuffer }, res ?? none),
    /** After `queue.submit` of the frame's encoder: the flags copied map. */
    submitted: () => ring.submitted(),
    dispose() {
      release()
      ring.destroy()
      viewBuffer.destroy()
    },
  }
}

export type GlobalField = ReturnType<typeof createGlobalField>
