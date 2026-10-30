import { oncePerDevice } from './oncePerDevice.ts'
import { queueSubmits, sharedGpuDevice } from './sessionHandle.ts'

/** A resource the retire list frees: a buffer, a texture, a pool of them. */
type Retired = { destroy(): void }

/** A retired resource and the sequence number the next encoder had when it was retired: the encoders numbered below it, still open, may bind it. */
interface Waiting {
  readonly resource: Retired
  readonly before: number
}

/** The resources retired on each device and not yet destroyed; every session's handle on
 *  a device shares its device's list. */
const retiredOf = oncePerDevice((): Waiting[] => [])

/** The encoders open on each device: made (`openEncoder`) and not yet settled, oldest first. */
const openOf = oncePerDevice((): Set<GPUCommandEncoder> => new Set())

/** The sequence number the next encoder made on each device takes. */
const sequenceOf = oncePerDevice(() => ({ next: 0 }))

/** The submits each device has taken (`destroyRetired` with the encoder it took): the age an open encoder is measured in. */
const submitsOf = oncePerDevice(() => ({ count: 0 }))

/** The submits an encoder may stay open across before it is reported as leaked. */
const STALE_AFTER_SUBMITS = 240

/** The encoders already reported as stale: said once. */
const reportedStale = new WeakSet<GPUCommandEncoder>()

/** An encoder made here: the open set it belongs to (its settle leaves it), the session that made it and its sequence number. */
const made = new WeakMap<
  GPUCommandEncoder,
  { open: Set<GPUCommandEncoder>; session: GPUDevice; sequence: number; submits: number }
>()

/** The encoders already settled: a release asked of one runs at once. */
const settledEncoders = new WeakSet<GPUCommandEncoder>()

/**
 * Makes an encoder with `make` and registers it as open on `device`, with its sequence number: it is open until its maker
 * settles it (submitted or dropped), and a resource retired meanwhile outlives it. The one place an encoder becomes open:
 * the code that made it settles it on every exit, so no encoder is ever left open by a lost owner.
 */
export function openEncoder(device: GPUDevice, make: () => GPUCommandEncoder) {
  const encoder = make(),
    shared = sharedGpuDevice(device),
    open = openOf(shared)
  open.add(encoder)
  made.set(encoder, {
    open,
    session: device,
    sequence: sequenceOf(shared).next++,
    submits: submitsOf(shared).count,
  })
  return encoder
}

/** Whether `encoder` was made by `openEncoder` (open or settled since). */
export const isMadeEncoder = (encoder: GPUCommandEncoder) => made.has(encoder)

/** Whether `encoder` was submitted or dropped. */
export const isSettledEncoder = (encoder: GPUCommandEncoder) => settledEncoders.has(encoder)

/**
 * THE RETIRE LIST: a resource replaced while the image is encoded — a table grown, a
 * target remade — may still be named by commands of an encoder not yet submitted, so it is retired
 * here rather than destroyed. It is destroyed by the first `destroyRetired` (a frame's `queue.submit`,
 * `../../frame/render/encoder.ts`) that finds every encoder open at its retire settled, and at a
 * session's dispose, after its last submit (`../../frame/io/metrics.ts`). Destroyed after the submit that names
 * it, it lives while that work runs: WebGPU frees a resource once the work submitted before its
 * `destroy` is done. One list per device and one walk a frame, no promise per resource. Where the
 * device itself was replaced (`replaced`), the old one can run nothing more and the resource is destroyed at once.
 */
export function retire(device: GPUDevice, resource: Retired, replaced = false) {
  // `replaced`: `device` was replaced, so no command naming the resource will ever be submitted and it goes at once.
  if (replaced) resource.destroy()
  else {
    const shared = sharedGpuDevice(device)
    retiredOf(shared).push({ resource, before: sequenceOf(shared).next })
  }
}

/**
 * After a `queue.submit` on `device` (`submitted`, the encoder it took, no longer binds anything), or with none (a paused tab, a view released, a dispose): every resource retired whose open encoders have all settled goes.
 * The list is compacted in place.
 */
export function destroyRetired(device: GPUDevice, submitted?: GPUCommandEncoder) {
  const shared = sharedGpuDevice(device)
  const open = openOf(shared)
  if (submitted) {
    submitsOf(shared).count++
    // Leaves the open set before anything else: a just-submitted encoder is never reported stale.
    open.delete(submitted)
  }
  const retired = retiredOf(shared)
  if (!retired.length) return
  // The open set is in sequence order: only its oldest encoder can hold back what was retired.
  const first = open.values().next()
  const oldest = first.done ? Infinity : (made.get(first.value)?.sequence ?? Infinity)
  let kept = 0
  for (const waiting of retired) {
    if (oldest < waiting.before) retired[kept++] = waiting
    else waiting.resource.destroy()
  }
  retired.length = kept
}

/**
 * Whether an encoder open on `device` has stayed open across more than `STALE_AFTER_SUBMITS` submits of the device and was not reported yet: a leaked encoder of any session holds every other session's retired resources.
 * The open set is walked oldest first, up to the first encoder young enough, skipping those already reported. Report only, the encoder is never destroyed here: its owner may still settle it. True once per encoder.
 */
export function staleOpenEncoder(device: GPUDevice) {
  const shared = sharedGpuDevice(device),
    count = submitsOf(shared).count
  for (const encoder of openOf(shared)) {
    if (count - (made.get(encoder)?.submits ?? Infinity) <= STALE_AFTER_SUBMITS) return false
    if (reportedStale.has(encoder)) continue
    reportedStale.add(encoder)
    return true
  }
  return false
}

/** A session's dispose, after its last submit: its own open encoders settle (their releases run, their commits never do) and everything no other open encoder holds goes; the other sessions of the shared device keep their encoders and what waits for them. */
export function destroyAllRetired(device: GPUDevice) {
  let failed: { error: unknown } | undefined
  for (const encoder of [...openOf(sharedGpuDevice(device))]) {
    if (made.get(encoder)?.session !== device) continue
    afterSubmit.delete(encoder)
    failed ??= attempt(() => settle(encoder))
  }
  const walked = attempt(() => destroyRetired(device))
  failed ??= walked
  if (failed) throw failed.error
}

/** What an encoder's passes advanced (a history, a kept surface), run once that encoder is submitted. */
const afterSubmit = new WeakMap<GPUCommandEncoder, (() => void)[]>()

/** What is released once an encoder is settled, submitted or dropped. */
const afterSettle = new WeakMap<GPUCommandEncoder, (() => void)[]>()

/** `action` joins the list `lists` keeps for `encoder`. */
function enlist(
  lists: WeakMap<GPUCommandEncoder, (() => void)[]>,
  encoder: GPUCommandEncoder,
  action: () => void,
) {
  const list = lists.get(encoder)
  if (list) list.push(action)
  else lists.set(encoder, [action])
}

/**
 * THE COMMIT OF AN ENCODER: `commit` runs right after the `queue.submit` of `encoder`
 * (`commitSubmitted`) and never if the encoder is dropped (`dropSubmitted`). Tied to the encoder that
 * carried the work, not to the device's next submit: an image encoded then dropped, or a view's
 * image submitted beside it, leaves what the passes advanced as it was.
 */
export function commitOnSubmit(encoder: GPUCommandEncoder, commit: () => void) {
  enlist(afterSubmit, encoder, commit)
}

/** `release` runs once `encoder` is settled (at once if it already is): right after its `queue.submit` (`commitSubmitted`) or when it is dropped unsubmitted (`dropSubmitted`). */
export function onSettled(encoder: GPUCommandEncoder, release: () => void) {
  if (settledEncoders.has(encoder)) release()
  else enlist(afterSettle, encoder, release)
}

/** The error `run` threw, if it threw. */
function attempt(run: () => void): { error: unknown } | undefined {
  try {
    run()
  } catch (error) {
    return { error }
  }
}

/** Runs every action of `actions`, even after one threw; the first error is thrown once all ran. */
export function runAll(actions: readonly (() => void)[] | undefined) {
  let failed: { error: unknown } | undefined
  for (const action of actions ?? []) {
    const result = attempt(action)
    failed ??= result
  }
  if (failed) throw failed.error
}

/** The encoder is settled: it leaves the open set and its releases run, as does any asked after. */
function settle(encoder: GPUCommandEncoder) {
  settledEncoders.add(encoder)
  made.get(encoder)?.open.delete(encoder)
  const releases = afterSettle.get(encoder)
  afterSettle.delete(encoder)
  runAll(releases)
}

/** After the `queue.submit` of `encoder`: its commits run, in the order they were asked, each though another threw; the encoder settles whatever they did; the first error of the commits, else of the settle, is thrown once both ran. */
export function commitSubmitted(encoder: GPUCommandEncoder) {
  const commits = afterSubmit.get(encoder)
  afterSubmit.delete(encoder)
  const failed = attempt(() => runAll(commits))
  const settleFailed = attempt(() => settle(encoder))
  const first = failed ?? settleFailed
  if (first) throw first.error
}

/** `encoder` is dropped unsubmitted: its commits never run. */
export function dropSubmitted(encoder: GPUCommandEncoder) {
  afterSubmit.delete(encoder)
  settle(encoder)
}

/**
 * THE SUBMIT OF AN ENCODER: finishes `encoder` and submits it on `device`. True when the queue took
 * the commands; false when a released session's queue took nothing (it ran none). An encoder the
 * queue did not take, or whose finish or submit threw, is dropped: its
 * commits never run and its releases are not kept. The caller commits a submitted one (`commitSubmitted`).
 * An encoder already settled (submitted or dropped) is refused, `onSettled` told: it carries nothing any more.
 */
export function submitCommands(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  onSettledRefusal?: () => void,
) {
  if (settledEncoders.has(encoder)) {
    onSettledRefusal?.()
    return false
  }
  const submitsBefore = queueSubmits(device)
  let reached = false
  try {
    device.queue.submit([encoder.finish()])
    // A released session's queue takes nothing: its count stands, and the commands never ran.
    reached = submitsBefore === undefined || queueSubmits(device) !== submitsBefore
  } finally {
    if (!reached) dropSubmitted(encoder)
  }
  return reached
}
