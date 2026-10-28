import { gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import { grantPending } from '../../gpu/core/errorScope.ts'
import {
  framesOf,
  heldCompiles,
  pipelinesCompiling,
  pipelinesSettled,
} from '../../lighting/deferred/compileLedger.ts'
import { litProgramPending } from '../prepare/contractLight.ts'
import { askFramePipelines, askFramePipelinesMoved } from './framePipelines.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { heldTargetGrant } from '../backend/state/gpu.ts'

/** One answer the device may still owe the frame: whether it is pending, read without allocating
 *  (the held frame asks it every frame), and the promise it settles with, `undefined` once given. */
type Answer = {
  /** What a trace of a held frame calls it (`heldOnAnswer`). */
  name: string | ((rt: WebgpuPagesRuntime) => string)
  pending: (rt: WebgpuPagesRuntime) => boolean
  answer: (rt: WebgpuPagesRuntime) => Promise<unknown> | undefined
}
const answerOf = (name: string, answer: Answer['answer']): Answer => ({
  name,
  pending: (rt) => answer(rt) !== undefined,
  answer,
})

/** Every answer, in one list both `deviceAnswering` and `deviceAnswer` read: the targets' grant
 *  the frames wait for (asked the held way, never one made aside), the lit program the device
 *  compiles, the compiles the frame waits for — counted while only asked whether
 *  (`pipelinesCompiling`). */
const ANSWERS: readonly Answer[] = [
  answerOf('targets in flight', (rt) => grantPending(heldTargetGrant(rt.gpu))),
  answerOf('lit program', litProgramPending),
  {
    // Each pipeline waited for by its name (`pipelineLabel`), never the word alone.
    name: (rt) => `pipelines: ${heldCompiles(rt.gpu.device).join(', ')}`,
    pending: (rt) => pipelinesCompiling(rt.gpu.device),
    answer: (rt) => pipelinesSettled(rt.gpu.device, true),
  },
]

const refusalOf = (rt: WebgpuPagesRuntime) => gpuDeviceLedgerOf(rt.gpu.device)?.refusal

/** What the device still answers for the frame — its targets, the lit program it compiles, the
 *  pipelines the next frame binds (`askFramePipelines`, asked here as a frame entry asks them) —,
 *  while it answers: an image drawn meanwhile would be incomplete or unlit, or
 *  compile on the frame, so the loop holds on it and a capture waits for it. `justEntered`: the
 *  loop asks right after the frame's entry asked, and a frame that moved nothing asks no more. Nothing is made while
 *  nothing is asked. */
export function deviceAnswer(rt: WebgpuPagesRuntime, justEntered = false) {
  const refusal = refusalOf(rt)
  if (refusal) return Promise.reject(refusal)
  if (justEntered) askFramePipelinesMoved(rt)
  else askFramePipelines(rt)
  // Each answer is asked once; the list is made only when one is in flight, so the frame with
  // none allocates nothing.
  let answers: Promise<unknown>[] | undefined
  for (const { answer } of ANSWERS) {
    const pending = answer(rt)
    if (pending !== undefined) (answers ??= []).push(pending)
  }
  return answers && Promise.all(answers)
}

/** Whether `deviceAnswer` has an answer in flight (`ANSWERS`, or the device's refusal), read
 *  without allocating: the held frame asks it every frame. */
export function deviceAnswering(rt: WebgpuPagesRuntime) {
  const device = rt.gpu.device
  if (refusalOf(rt)) return noted(device, 'device refusal')
  for (let at = 0; at < ANSWERS.length; at++)
    if (ANSWERS[at].pending(rt)) {
      const { name } = ANSWERS[at]
      return noted(device, typeof name === 'string' ? name : name(rt))
    }
  return noted(device, undefined)
}

/** What each device's frames were last held on (`deviceAnswering`), none once it answered: read by a trace of why frames were held. Written without allocating. */
const heldOn = new WeakMap<GPUDevice, string | undefined>()
function noted(device: GPUDevice | undefined, name: string | undefined) {
  if (device) heldOn.set(device, name)
  return name !== undefined
}

/** The answer `device`'s frames were last held on, none when the last frame asked had its answers. A frame held with none was held on the targets' refused size, waiting to ask it again (`frameTargetsAwaited`). */
export const heldOnAnswer = (device: GPUDevice | undefined) => device && heldOn.get(device)

/** What the last frame that entered did on a device, for a trace of why frames were drawn or held (`noteHold`); one record a device, written in place. */
export type HoldRecord = {
  drawn: boolean
  frameHeld: boolean
  heldEmpty: boolean
  /** `drawn`, `still` (nothing moved: the previous image shown), the answer held on (`deviceAnswering`), or the targets' grant: in flight, or refused and waiting to be asked again. */
  reason: string
  /** For a refused grant, the frame (counted in frames entered) it is asked again at, else 0. */
  retryAt: number
  entered: number
  /** Every frame that entered since the device opened, by `reason`: how many, the frame entered first and last, and how many of them reported a still image (`frameHeld`)
   *  or no image at all (`heldEmpty`). The page sees only the frames it was told of; these are all. */
  byReason: Record<
    string,
    { count: number; first: number; last: number; frameHeld: number; heldEmpty: number }
  >
}
const records = new WeakMap<GPUDevice, HoldRecord>()
/** The device `noteHold` last wrote on: the session's handle (`claimGpuDevice`), the one every ledger is keyed by, which is not the device the world holds. A page reads the ledgers through it. */
let lastDevice: GPUDevice | undefined

/** What the frame that entered did, written in place; `answered` and `awaited` as `holdWebgpuFrame` read them. */
export function noteHold(
  rt: WebgpuPagesRuntime,
  drawn: boolean,
  answered: boolean,
  awaited: boolean,
) {
  const device = rt.gpu.device
  if (!device) return
  let record = records.get(device)
  if (!record)
    records.set(
      device,
      (record = {
        drawn: false,
        frameHeld: false,
        heldEmpty: false,
        reason: '',
        retryAt: 0,
        entered: 0,
        byReason: {},
      }),
    )
  lastDevice = device
  const grant = heldTargetGrant(rt.gpu)
  record.drawn = drawn
  record.frameHeld = rt.run.frameHeld
  record.heldEmpty = rt.run.heldEmpty
  record.entered = framesOf(device)
  record.retryAt = awaited ? (grant?.retryAt ?? 0) : 0
  record.reason = drawn
    ? 'drawn'
    : !answered
      ? (heldOnAnswer(device) ?? 'device refusal')
      : awaited
        ? grant && !grant.settled
          ? 'targets in flight'
          : 'targets refused, waiting to ask again'
        : 'still'
  const total = (record.byReason[record.reason] ??= {
    count: 0,
    first: record.entered,
    last: record.entered,
    frameHeld: 0,
    heldEmpty: 0,
  })
  total.count++
  total.last = record.entered
  if (record.frameHeld) total.frameHeld++
  if (record.heldEmpty) total.heldEmpty++
}

/** The last frame that entered on `device`, as `noteHold` wrote it. */
export const lastHold = (device: GPUDevice | undefined) => device && records.get(device)

/** The session handle the ledgers of the frames entered last are keyed by (`noteHold`). */
export const holdDevice = () => lastDevice
