/**
 * THE ENTRIES OF THE COMPOSITION'S PASSES (`gpuCompose.ts`), read live (`liveBuffer`): each pass's
 * group made once, and again only when a buffer it names is replaced.
 */
import { uniformStride } from '../residency/pools.ts'
import { liveBuffer } from '../webgpu/core/liveEntries.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { WORLD_ORIGIN_BYTES } from '../gpu/dag/worldOrigins.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { ComposeGpu } from './gpuComposeGpu.ts'

/** The world range `r` of the cut this frame, and its first `count` worlds' words as a binding
 *  of `bytes` each. */
const rangeOf = (gpu: ComposeGpu, r: number) => gpu.frame.ranges[r]
const rangeBytes = (gpu: ComposeGpu, r: number, bytes: number) => () =>
  rangeOf(gpu, r).count * bytes

/** The roots pass's entries over range `r` (`COMPOSE_ROOTS_WGSL`), read live: its parameters'
 *  slot, the roots' double worlds, the parents' indices, its worlds, the motion and its mode, the
 *  previous worlds and the roots' list. */
export const rootEntries = (
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  gpu: ComposeGpu,
  r: number,
) =>
  sequentialEntries([
    liveBuffer(
      () => gpu.rootParams.buffer,
      () => r * uniformStride(device.limits),
      () => 16,
    ),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => gpu.parentOf),
    liveBuffer(
      () => rangeOf(gpu, r).buffer,
      undefined,
      rangeBytes(gpu, r, 64 + WORLD_ORIGIN_BYTES),
    ),
    liveBuffer(() => gpu.frame.motion ?? gpu.noMotion),
    liveBuffer(() => gpu.motionMode),
    liveBuffer(() => gpu.previous),
    liveBuffer(() => gpu.rankList),
  ])

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
