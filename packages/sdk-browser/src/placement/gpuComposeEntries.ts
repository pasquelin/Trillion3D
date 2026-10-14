/**
 * THE ENTRIES OF THE COMPOSITION'S PASSES (`gpuCompose.ts`), read live (`liveBuffer`): each pass's
 * group made once, and again only when a buffer it names is replaced.
 */
import { liveBuffer, resourceEntry } from '../webgpu/core/liveEntries.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { ComposeGpu } from './gpuComposeGpu.ts'
import { COMPOSE_WORLDS_BINDING } from './gpuComposeWgsl.ts'

/** The roots pass's entries (`COMPOSE_ROOTS_WGSL`), read live: its parameters, the roots' double
 *  worlds, the parents' indices, the cut's worlds and the roots' list. */
export const rootEntries = (rt: WebgpuPagesRuntime, gpu: ComposeGpu) => [
  ...sequentialEntries([
    liveBuffer(
      () => gpu.rootParams.buffer,
      undefined,
      () => gpu.rootParams.words.byteLength,
    ),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => gpu.parentOf),
  ]),
  resourceEntry(COMPOSE_WORLDS_BINDING, () => gpu.frame.worlds),
  ...sequentialEntries([liveBuffer(() => gpu.rankList)], COMPOSE_WORLDS_BINDING + 1),
]

/** The motion pass's entries (`COMPOSE_MOTION_WGSL`), read live: the roots pass's parameters, the
 *  roots' double worlds, the parents' indices, the motion the roots pass bound and its mode, the
 *  previous worlds and the roots' list. */
export const motionEntries = (rt: WebgpuPagesRuntime, gpu: ComposeGpu) =>
  sequentialEntries([
    liveBuffer(
      () => gpu.rootParams.buffer,
      undefined,
      () => gpu.rootParams.words.byteLength,
    ),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => gpu.parentOf),
    liveBuffer(() => rt.compose?.motionBound),
    liveBuffer(() => gpu.motionMode),
    liveBuffer(() => gpu.previous),
    liveBuffer(() => gpu.rankList),
  ])

/** The worlds pass's entries (`COMPOSE_WORLDS_WGSL`), read live: its parameters, the links, the
 *  parents' indices, the parents, the roots' double worlds and the roots' list. */
export const worldEntries = (rt: WebgpuPagesRuntime, gpu: ComposeGpu) =>
  sequentialEntries([
    liveBuffer(
      () => gpu.worldParams.buffer,
      undefined,
      () => gpu.worldParams.words.byteLength,
    ),
    liveBuffer(() => gpu.locals),
    liveBuffer(() => gpu.parentOf),
    liveBuffer(() => gpu.parents),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => gpu.rankList),
  ])
