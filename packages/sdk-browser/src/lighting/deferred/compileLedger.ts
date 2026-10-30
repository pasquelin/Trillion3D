// The compiles in flight on a device, and whether its frames wait for each: the pipelines prepared
// off the frame (`fullscreen.ts`), and the programs a frame needs that no ready one stands in for
// (`track`, `held`). The frame gate reads it (`../../frame/loop/deviceAnswer.ts`). An object whose
// classes compile is not among them: it does not join the session before they are ready
// (`../../placement/append/classGate.ts`).

import { deviceLost } from '../../gpu/core/deviceOwners.ts'

/** The compiles in flight on a device — a session's handle, or the device itself —, each with
 *  whether its frames wait for it and the name it was tracked under, and how many they wait for. */
type Ledger = {
  compiles: Map<Promise<unknown>, { held: boolean; label: string }>
  held: number
  /** Who hears of a refused compile landing on a retry (`onRetryLanded`). */
  landings: Set<() => void>
  /** The compiles the device refused, not yet said (`takeRefusals`). */
  refusals: string[]
}
const ledgers = new WeakMap<GPUDevice, Ledger>()
const ledgerOf = (device: GPUDevice) => {
  let ledger = ledgers.get(device)
  if (!ledger)
    ledgers.set(
      device,
      (ledger = {
        compiles: new Map(),
        held: 0,
        landings: new Set(),
        refusals: [],
      }),
    )
  return ledger
}

/** `retry` called once, `ms` from now, off the frame — a view at rest tries a refused compile again as well, and a frame's entry does no work for it —, unless it was collected meanwhile: it is held weakly, so a pipeline nothing names takes its retry with it, and `lost` is called in its place (whoever waits for the retry is not left waiting for ever).
 *  A timer waits no process out (`unref`, where the host has one). */
export function retryAfter(retry: () => void, ms: number, lost: () => void) {
  const ref = new WeakRef(retry),
    timer = setTimeout(() => (ref.deref() ?? lost)(), ms)
  ;(timer as { unref?: () => void }).unref?.()
}

/** `heard` called each time a refused compile of `device` lands on a retry, until the returned function stops it: a retry holds no frame (nothing waits for it), so a view at rest would keep the stand-in
 *  that was lent meanwhile; the hearer redraws it. */
export function onRetryLanded(device: GPUDevice, heard: () => void) {
  const { landings } = ledgerOf(device)
  landings.add(heard)
  return () => void landings.delete(heard)
}

/** A refused compile of `device` landed on a retry (`onRetryLanded`); none is heard of a device that was lost. */
export function retryLanded(device: GPUDevice) {
  if (!deviceLost(device)) for (const heard of [...ledgerOf(device).landings]) heard()
}

/** `device` refused a compile, `label` its pipeline: said once, by the next frame's entry. */
export const refuse = (device: GPUDevice, label: string) =>
  void ledgerOf(device).refusals.push(label)

/** The refusals not yet said, given up to the caller. */
export function takeRefusals(device: GPUDevice) {
  const ledger = ledgers.get(device)
  return ledger?.refusals.length ? ledger.refusals.splice(0) : undefined
}

/** The name of a compile tracked under none. */
const UNNAMED = 'unnamed'

/** The name a pipeline is tracked under: its descriptor's own label, else the label of the module it compiles (fragment, vertex or compute stage), else `UNNAMED`. */
export function pipelineLabel(descriptor: object) {
  const { label, fragment, vertex, compute } = descriptor as {
    label?: string
    fragment?: { module: { label?: string } }
    vertex?: { module: { label?: string } }
    compute?: { module: { label?: string } }
  }
  return label || fragment?.module.label || vertex?.module.label || compute?.module.label || UNNAMED
}

/** `compile`, in flight on `device` until it settles; its frames wait for it once `held` — a program
 *  a frame needs that no ready one stands in for, as a lobed surface's lobe code
 *  (`../../frame/prepare/contractLight.ts`). `label` names it in a trace of what the frames wait for
 *  (`heldCompiles`). `compile` keeps its identity while in flight:
 *  asked again, it adds nothing; none, nothing to track. */
export function track(
  device: GPUDevice,
  compile: Promise<unknown> | undefined,
  held: boolean,
  label = UNNAMED,
) {
  if (!compile) return
  const ledger = ledgerOf(device),
    known = ledger.compiles.get(compile)
  if (known === undefined) {
    const settled = () => untrack(device, compile)
    compile.then(settled, settled)
  } else if (known.held || !held) return
  ledger.compiles.set(compile, { held, label })
  if (held) ledger.held++
}

/** `compile` leaves `device`'s ledger: it settled, or its pipeline was made without it. */
function untrack(device: GPUDevice, compile: Promise<unknown>) {
  const ledger = ledgers.get(device),
    known = ledger?.compiles.get(compile)
  if (!ledger || !known) return
  ledger.compiles.delete(compile)
  if (known.held) ledger.held--
}

/** The labels of the compiles the frames of `device` wait for now, for a trace of why a frame was held. */
export const heldCompiles = (device: GPUDevice | undefined) =>
  [...(device ? (ledgers.get(device)?.compiles ?? []) : [])]
    .filter(([, { held }]) => held)
    .map(([, { label }]) => label)

/** Whether a compile the frames drawn on `device` wait for is in flight: the frame gate reads it at
 *  every frame (`deviceAnswering`), so it allocates nothing. */
export const pipelinesCompiling = (device: GPUDevice | undefined) =>
  !!device && (ledgers.get(device)?.held ?? 0) > 0

/** Settles once every compile in flight on `device` has, refused ones included — those its frames
 *  wait for alone when `held` —; `undefined` when none is. Prepare waits for all, so the first
 *  frame compiles nothing; a held frame for those it waits for. */
export function pipelinesSettled(device: GPUDevice | undefined, held = false) {
  const compiles = device && ledgers.get(device)?.compiles
  if (!compiles?.size) return undefined
  const waits = [...compiles].filter(([, known]) => known.held || !held).map(([compile]) => compile)
  return waits.length ? Promise.allSettled(waits).then(() => undefined) : undefined
}
