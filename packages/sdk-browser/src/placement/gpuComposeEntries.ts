/**
 * THE ENTRIES OF THE COMPOSITION'S PASSES (`gpuCompose.ts`), read live (`liveBuffer`): each pass's
 * group made once, and again only when a buffer it names is replaced.
 */
import { uniformStride } from '../residency/pools.ts'
import { liveBuffer, resourceEntry } from '../webgpu/core/liveEntries.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { ComposeGpu } from './gpuComposeGpu.ts'
import { COMPOSE_WORLDS_BINDING } from './gpuComposeWgsl.ts'

/** The roots pass's entries over range `r` (`COMPOSE_ROOTS_WGSL`), read live: its parameters'
 *  slot, the roots' double worlds, the parents' indices, the cut's worlds, the motion and its mode,
 *  the previous worlds and the roots' list. */
export const rootEntries = (
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  gpu: ComposeGpu,
  r: number,
) => [
  ...sequentialEntries([
    liveBuffer(
      () => gpu.rootParams.buffer,
      () => r * uniformStride(device.limits),
      () => 16,
    ),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => gpu.parentOf),
  ]),
  resourceEntry(COMPOSE_WORLDS_BINDING, () => gpu.frame.worlds),
  ...sequentialEntries(
    [
      liveBuffer(() => gpu.frame.motion ?? gpu.noMotion),
      liveBuffer(() => gpu.motionMode),
      liveBuffer(() => gpu.previous),
      liveBuffer(() => gpu.rankList),
    ],
    COMPOSE_WORLDS_BINDING + 1,
  ),
]

/** The worlds pass's entries (`COMPOSE_WORLDS_WGSL`), read live: its parameters, the links, the
 *  parents' indices, the parents, the roots' double worlds and the roots' list. */
export const worldEntries = (rt: WebgpuPagesRuntime, gpu: ComposeGpu) =>
  sequentialEntries([
    liveBuffer(
      () => gpu.worldParams,
      undefined,
      () => 16,
    ),
    liveBuffer(() => gpu.locals),
    liveBuffer(() => gpu.parentOf),
    liveBuffer(() => gpu.parents),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => gpu.rankList),
  ])
