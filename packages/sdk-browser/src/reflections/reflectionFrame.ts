import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { shadowEpoch } from '../webgpu/pages/state/shadowEpoch.ts'
import { materialEpoch } from '../webgpu/pages/io/refreshMaterials.ts'
import {
  REFLECTION_LIGHTING_VERSIONS,
  REFLECTION_PLACEMENT_VERSIONS,
  type ReflectionHistoryFrame,
} from './historyFrame.ts'

const frames = new WeakMap<object, ReflectionHistoryFrame>()

/** Versions come from their writers: receiver motion alone cannot describe a
 * reflection's dependency on a moving, relit or newly resident reflected object. The frame of an
 * active reflection, whether a rough history reads it or the reflection source alone (`source.ts`). */
export function reflectionFrame(rt: WebgpuPagesRuntime): ReflectionHistoryFrame | undefined {
  const { gpu, vis, run, layout, lights, bounce } = rt
  if (
    !gpu.reflection?.active ||
    !gpu.depthTexture ||
    !gpu.surfaces ||
    !vis.visTexture ||
    !vis.visView ||
    !vis.pageTable
  )
    return undefined
  let frame = frames.get(gpu.reflection)
  if (!frame) {
    frame = {
      metadata: {},
      epoch: new Float64Array(REFLECTION_PLACEMENT_VERSIONS),
      lighting: new Float64Array(REFLECTION_LIGHTING_VERSIONS),
    } as ReflectionHistoryFrame
    frames.set(gpu.reflection, frame)
  }
  const { metadata, epoch, lighting } = frame
  // The textures the lighting binds (`depth`, `normalRough`, `vis`), which the rough trace records
  // its texels' pixels from (`sampleWgsl.ts`): the resolve reads the same bits.
  metadata.depth = gpu.depthTexture
  metadata.normal = gpu.surfaces.normalRough
  metadata.ids = vis.visTexture
  frame.ids = vis.visView
  frame.pages = vis.pageTable
  // The placement motion the temporal pass writes before this image's submission, live only while
  // that pass accumulates: moved sources are then reprojected. Otherwise the page table, bound and
  // never read, and a pose change keeps the history at the change weight
  // (`REFLECTION_CHANGE_KEPT`). No second table is made.
  frame.motion = gpu.temporal?.frame.active ? gpu.temporal.motion.buffer : vis.pageTable
  frame.eye = run.gate.cam.eye
  // What places a reflected point: the scene, residency, poses, the bounce proxy, the probes and
  // shadows they redraw, deformation. A moved point is followed by the placement motion, and its
  // shadow and bounce move with it: a camera move alone redraws shadow pages, and the probes
  // encode every image a mover turns.
  epoch[0] = run.gate.revisions.scene
  epoch[1] = run.gate.revisions.resources
  epoch[2] = layout.rows.tableEpoch
  epoch[3] = bounce.probes?.proxy.revision ?? 0
  epoch[4] = bounce.probes?.encodedFrames ?? 0
  epoch[5] = shadowEpoch(lights)
  epoch[6] = vis.deformation?.frame.revision ?? 0
  // What lights it, the lights' transport and the materials' values: no motion brings an old
  // lighting to the new one, their change resets the history (`historyRuntime.ts`).
  lighting[0] = lights.store.transportEpoch
  lighting[1] = materialEpoch(rt)
  // Every version mixed, the scene's scrambled: independent of wall clock.
  let seed = Math.imul(epoch[0], 747796405)
  for (let i = 1; i < epoch.length; i++) seed ^= epoch[i]
  for (let i = 0; i < lighting.length; i++) seed ^= lighting[i]
  frame.seed = seed >>> 0
  frame.frame = run.frame
  frame.camera = run.gate.cam.viewProjection
  return frame
}
