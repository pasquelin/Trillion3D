import { gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import { grantPending } from '../../gpu/core/errorScope.ts'
import { pipelinesCompiling, pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { litProgramPending } from '../pages/prepare/lightResources.ts'
import { askFramePipelines } from './framePipelines.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** One answer the device may still owe the frame: whether it is pending, read without allocating
 *  (the held frame asks it every frame), and the promise it settles with, `undefined` once given. */
type Answer = {
  pending: (rt: WebgpuPagesRuntime) => boolean
  answer: (rt: WebgpuPagesRuntime) => Promise<unknown> | undefined
}
const answerOf = (answer: Answer['answer']): Answer => ({
  pending: (rt) => answer(rt) !== undefined,
  answer,
})

/** Every answer, in one list both `deviceAnswering` and `deviceAnswer` read: the targets' grant,
 *  the lit program the device compiles, the compiles the frame waits for — counted while only
 *  asked whether (`pipelinesCompiling`). */
const ANSWERS: readonly Answer[] = [
  answerOf((rt) => grantPending(rt.gpu.targetGrant)),
  answerOf(litProgramPending),
  {
    pending: (rt) => pipelinesCompiling(rt.gpu.device),
    answer: (rt) => pipelinesSettled(rt.gpu.device, true),
  },
]

const refusalOf = (rt: WebgpuPagesRuntime) => gpuDeviceLedgerOf(rt.gpu.device)?.refusal

/** What the device still answers for the frame — its targets, the lit program it compiles, the
 *  pipelines the next frame binds (`askFramePipelines`, asked here as a frame entry asks them) —,
 *  while it answers: an image drawn meanwhile would be incomplete (#483) or unlit (#1362), or
 *  compile on the frame, so the loop holds on it and a capture waits for it. Nothing is made while
 *  nothing is asked. */
export function deviceAnswer(rt: WebgpuPagesRuntime) {
  const refusal = refusalOf(rt)
  if (refusal) return Promise.reject(refusal)
  askFramePipelines(rt)
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
  if (refusalOf(rt)) return true
  for (let at = 0; at < ANSWERS.length; at++) if (ANSWERS[at].pending(rt)) return true
  return false
}
