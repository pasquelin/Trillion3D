import { validating } from './validation.ts'
import { installGpuGlobals } from './globals.ts'
import type { FakeDeviceOptions, LostInfo } from './fakeRecords.ts'

/** One open error scope: the filter it was opened with and the first error raised under it. */
export type ErrorScope = { filter: GPUErrorFilter; error: object | null }

/** The kind of scope that catches an error: its class decides, as WebGPU's does. */
const filterOf = (error: object): GPUErrorFilter =>
  error instanceof GPUOutOfMemoryError
    ? 'out-of-memory'
    : error instanceof GPUInternalError
      ? 'internal'
      : 'validation'

/** A device's error scopes, one stack, innermost last: `push` opens one, `pop` closes the innermost and gives its error, and refuses with none open as WebGPU does. */
const errorScopes = (scopes: ErrorScope[]) => ({
  pushErrorScope: (filter: GPUErrorFilter) => void scopes.push({ filter, error: null }),
  popErrorScope: async () => {
    if (!scopes.length) throw new DOMException('No error scope to pop', 'OperationError')
    return scopes.pop()!.error
  },
})

/** `error` caught by the innermost scope of its kind; whether one caught it. */
export function catchError(scopes: readonly ErrorScope[], error: object) {
  const filter = filterOf(error)
  const scope = scopes.findLast((open) => open.filter === filter)
  if (scope) scope.error ??= error
  return scope !== undefined
}

/** An out-of-memory error with `message`, raised in the innermost out-of-memory scope open; an error no scope catches throws, as a test that forgot its scope, not a silent `uncapturederror`. */
export function raiseOutOfMemory(scopes: readonly ErrorScope[], message: string) {
  if (!catchError(scopes, new GPUOutOfMemoryError(message)))
    throw new Error('fakeDevice: out of memory outside an out-of-memory error scope')
}

/**
 * A device as WebGPU writes one, around the members `fakeDevice` provides: an `EventTarget` (a
 * test raises `uncapturederror` with `raise`), a `lost` that settles on `lose`, one stack of error
 * scopes (an error raised under one is caught there, not dispatched), WebGPU's validation of every
 * creation, write and copy (`validation.ts`), and creations that refuse a
 * `this` that is not the device ("Illegal invocation"). `given` records every descriptor a
 * creation received, `labels` the label each carried at that moment.
 */
export function asWebgpuDevice(
  members: Record<string, unknown>,
  scopes: ErrorScope[] = [],
  { strictScopes = false }: Pick<FakeDeviceOptions, 'strictScopes'> = {},
) {
  // WebGPU's globals, its error classes among them: what the engine tests a raised error against.
  installGpuGlobals()
  // Every call checked by WebGPU's rules before it is made (`validation.ts`).
  validating(members)
  let settle: (info: LostInfo) => void = () => {}
  const lost = new Promise<LostInfo>((resolve) => (settle = resolve))
  const given: Array<{ label?: string } | undefined> = [],
    labels: Array<string | undefined> = []
  const target = new EventTarget()
  const device = Object.assign(target, members, {
    lost,
    ...errorScopes(scopes),
  }) as unknown as Record<string, unknown>
  for (const key of Object.keys(members)) {
    const make = members[key]
    if (!key.startsWith('create') || typeof make !== 'function') continue
    device[key] = function (this: unknown, descriptor?: { label?: string }) {
      if (this !== device) throw new TypeError('Illegal invocation')
      if (strictScopes && !key.endsWith('Async') && !scopes.length)
        throw new Error(`created outside any error scope: ${key} ${descriptor?.label ?? ''}`.trim())
      given.push(descriptor)
      labels.push(descriptor?.label)
      return make(descriptor)
    }
  }
  return {
    device: device as unknown as GPUDevice,
    given,
    labels,
    scopes,
    /** Raises an error: caught by the innermost scope open of its kind (`catchError`), dispatched as
     *  `uncapturederror` otherwise; returns whether a listener cancelled it. */
    raise(message: string, error: object = { message }) {
      if (catchError(scopes, error)) return false
      const event = Object.assign(new Event('uncapturederror', { cancelable: true }), { error })
      return !target.dispatchEvent(event)
    },
    /** Settles `device.lost` with `info`, as a driver reset or a `destroy` would. */
    lose: (info: LostInfo = { reason: 'destroyed', message: 'destroyed' }) => settle(info),
  }
}

/** An owner of a device claim (`claimGpuDevice`) that records what reaches it. */
export function deviceOwner() {
  const errors: string[] = [],
    reasons: string[] = [],
    closed: string[] = [],
    losses: string[] = []
  return {
    errors,
    reasons,
    closed,
    losses,
    error: (message: string, reason: string) => (errors.push(message), reasons.push(reason)),
    closedError: (message: string) => closed.push(message),
    lost: (info: { reason: string }) => losses.push(info.reason),
  }
}

/** A label as the engine wrote it, without the session tag `sessionHandle.ts` joins to it. */
export const untag = (label: string | undefined) => label?.replace(/ ?@t3d:\d+$/, '') || undefined
