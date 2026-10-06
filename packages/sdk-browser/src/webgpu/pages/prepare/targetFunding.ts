import { grantPending, startGrant, type DeviceGrant } from '../../../gpu/core/errorScope.ts'
import { gpuDeviceLedgerOf } from '../../../gpu/core/deviceLedger.ts'
import { vsmAskedBytes, vsmReserveBytes } from '../render/vsm/vsmPlan.ts'
import { shadowHeldBytes } from '../render/vsm/vsmStats.ts'
import { setWebgpuMemoryBudgets, textureBytesBeside } from '../io/memory.ts'
import { vertexBytesOf } from '../io/metrics.ts'
import { TAA_HISTORY_BYTES_PER_PIXEL } from '../../../taa/temporalAntialiasing.ts'
import { FILTER_HISTORY_BYTES_PER_PIXEL } from '../../../taa/layers.ts'
import { DISPLAY_LAYER_BYTES_PER_PIXEL } from '../../blend/displayFilter.ts'
import { frameExtraBytes, frameTargetAllocation } from './targetAllocation.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { frameSizeOf, type FrameSize } from '../state/renderScale.ts'
import { viewGpu, type WebgpuView } from '../state/view.ts'

/** Admit proposed targets before makeTargets creates any resource. Pool floors use
 * the same constructors as normal residency, so root coverage and texture tails
 * cannot be silently enlarged after this budget transaction. */
const funded = new WeakMap<WebgpuPagesRuntime, number>()
/** The pools funded again beside targets already in place, one at a time. */
const refreshing = new WeakMap<WebgpuPagesRuntime, DeviceGrant>()

function refreshTargetFunding(rt: WebgpuPagesRuntime, size: FrameSize) {
  if (!rt.context.admitGpuMemory) return
  const bytes = gpuDeviceLedgerOf(rt.gpu.device)?.bytes
  if (bytes === undefined || bytes === funded.get(rt)) return
  // Asked once per ledger state, granted or refused: a refusal is said once, not every frame.
  funded.set(rt, bytes)
  try {
    return fundFrameTargets(rt, size, 0, true)
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Bytes a frame of `size` makes once its targets are (`makeTargets`), counted in them after: the
 * temporal history at the display's size, made only while the pass is on (`ensureTaaTargets`), and,
 * while a blend filters a beauty image, its layers at the render size (`beginDisplayFilter`) and
 * their history beside the colour's.
 */
function frameMadeBytes(rt: WebgpuPagesRuntime, size: FrameSize) {
  const { gpu } = rt,
    display = size.width * size.height,
    filters =
      rt.blendState.filtersDisplay &&
      rt.run.diagnostic === 'beauty' &&
      !rt.context.diagnosticGpuVariant
  const history = !!gpu.temporal && gpu.temporalWanted && !rt.capture.capturing
  return (
    (history
      ? display * (TAA_HISTORY_BYTES_PER_PIXEL + (filters ? FILTER_HISTORY_BYTES_PER_PIXEL : 0))
      : 0) + (filters ? size.renderWidth * size.renderHeight * DISPLAY_LAYER_BYTES_PER_PIXEL : 0)
  )
}

/** The drawn view's frame at the render scale's maximum, written by `frameShareBytes`. */
const fullSize = {} as FrameSize

/**
 * THE FRAME'S SHARE OF A DEFAULT GPU TOTAL (`ActiveGpuMemory.frameShare`): the drawn view's frame
 * at the render scale's maximum on its viewport (`frameSizeOf`) — what it asks with its targets
 * (`frameTargetAllocation`, `frameExtraBytes`) and what it makes after them (`frameMadeBytes`) —,
 * and each other view's targets and effect chain as they hold them. Measured by the functions that
 * allocate, never written by hand: the default total (`defaultGpuBudget`) funds it before the
 * pools, so the frame's targets are made at the scale's maximum on any canvas, whatever the pools
 * hold.
 * The shadows' mask, sized by the frame, is the shadows' own term (`vsmAskedBytes`).
 */
function frameShareBytes(rt: WebgpuPagesRuntime) {
  const size = frameSizeOf(rt, fullSize, true),
    { views } = rt
  let bytes = frameTargetAllocation(rt, size, frameExtraBytes(rt, size)) + frameMadeBytes(rt, size)
  const held = (view: WebgpuView) => {
    if (view === views.active) return 0
    const gpu = viewGpu(rt, view)
    return gpu.targetBytes + (gpu.effects?.bytes ?? 0)
  }
  bytes += held(views.main)
  for (const view of views.persistent) bytes += held(view)
  return bytes
}

export function fundFrameTargets(
  rt: WebgpuPagesRuntime,
  size: FrameSize,
  bytes: number,
  current = false,
) {
  const admit = rt.context.admitGpuMemory
  if (!admit) return
  const { setup, gpu, vis, bounce } = rt
  const vertexBytes = vertexBytesOf(gpu, vis)
  const sourceBytes = textureBytesBeside(rt)
  const geometryMinimum = setup.geometryPoolFor(1).allocatedBytes + vertexBytes
  const textureMinimum = (setup.texturePools?.poolFor(1).allocatedBytes ?? 0) + sourceBytes
  const made = frameMadeBytes(rt, size)
  // The shadows hold their share (`shadowHeldBytes`), and are funded for what this frame's size
  // asks of them before the pools (`vsmAskedBytes`).
  const shadowHeld = shadowHeldBytes(rt)
  const shadowPool = shadowHeld + vsmAskedBytes(rt, size.renderWidth, size.renderHeight)
  const bounceProbes = bounce.probes ? 2 * bounce.probes.probeBytes : 0
  const effectTargets = gpu.effects?.bytes ?? 0
  const ledger = gpuDeviceLedgerOf(gpu.device)?.snapshot()
  if (ledger?.unknownFormats) throw new Error('GPU_BUDGET_UNKNOWN_FORMAT')
  // Auxiliary buffers, other views/captures and proxy resources are already live.
  // Credit only the active view being replaced and the separately charged pools;
  // the device ledger is the existing ownership accounting, not a second budget.
  const separatelyHeld =
    gpu.targetBytes +
    shadowHeld +
    bounceProbes +
    effectTargets +
    setup.geometryPool.allocatedBytes +
    vertexBytes +
    (setup.texturePools?.pool.allocatedBytes ?? 0) +
    sourceBytes
  const unaccounted = (ledger?.bytes ?? separatelyHeld) - separatelyHeld
  const pools = admit({
    frameTargets: current
      ? Math.max(0, unaccounted + gpu.targetBytes)
      : bytes + made + Math.max(0, unaccounted),
    frameShare: frameShareBytes(rt),
    shadowPool,
    shadowReserve: vsmReserveBytes(rt),
    bounceProbes,
    effectTargets,
    geometryMinimum,
    textureMinimum,
  })
  // This call may run inside prepare itself: the host report's wait would await
  // this very target grant. Admission only redistributes the existing tables.
  const record = () => {
    funded.set(rt, gpuDeviceLedgerOf(gpu.device)?.bytes ?? 0)
  }
  if (
    pools.geometryPoolBytes !== setup.geometryPool.budgetBytes ||
    pools.texturePoolBytes !== setup.texturePoolBudget
  )
    return setWebgpuMemoryBudgets(rt, pools, 'prepare-targets').then(record)
  record()
}

/** The pools' funding beside the frames still in flight, if any: no frame waits for it, but a
 *  target grant and a capture do, so two fundings never move the pools at once. */
export const poolFundingPending = (rt: WebgpuPagesRuntime) => grantPending(refreshing.get(rt))

/**
 * The targets in place fit: the pools are funded again beside the frames, never holding one — a
 * budget moves quality, never presentation (#1362). A refusal is said (`refuse`) and keeps the
 * pools in place. Prepare and capture await the answer.
 */
export function refreshTargetGrant(
  rt: WebgpuPagesRuntime,
  size: FrameSize,
  refuse: (error: unknown) => void,
) {
  const pending = poolFundingPending(rt)
  if (pending) return pending
  const refresh = refreshTargetFunding(rt, size)
  if (!refresh) return
  const grant = startGrant(refresh.catch(refuse))
  refreshing.set(rt, grant)
  return grant.done
}
