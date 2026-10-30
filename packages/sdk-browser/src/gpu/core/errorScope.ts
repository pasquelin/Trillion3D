import { constructGpuResources } from './deviceLedger.ts'

/** Destroys, in order, every resource a failed setup made. A `destroy` that throws is passed
 *  over, so the setup's own failure is the one reported. */
export function destroyAll(resources: Iterable<{ destroy(): void } | undefined>) {
  for (const resource of resources)
    try {
      resource?.destroy()
    } catch {
      /* Partial setup. */
    }
}

const none = () => null

type GPUPipelineErrorReason = GPUPipelineError['reason']

/**
 * `make` under a scope of `filter` that is popped before this returns, a throw included: the scope
 * code every caller shares. `popped` is the device's verdict, to read when it is wanted; one
 * never read, a throw's among them, is not an unhandled rejection.
 */
function scopedNow<T>(device: GPUDevice, filter: GPUErrorFilter, make: () => T) {
  let made: T
  let popped: Promise<GPUError | null>
  device.pushErrorScope(filter)
  try {
    made = make()
  } finally {
    popped = device.popErrorScope()
    popped.catch(none)
  }
  return { made, popped }
}

/** A pipeline refusal for `message`: the host's `GPUPipelineError`, else (a host without the class) an `Error` named as it is with its `reason`, which is how a refusal is classified where the class is missing (`isPipelineError`, `../../lighting/deferred/fullscreen.ts`). */
const pipelineError = (message: string, reason: GPUPipelineErrorReason): GPUPipelineError =>
  typeof GPUPipelineError !== 'undefined'
    ? new GPUPipelineError(message, { reason })
    : (Object.assign(new Error(message), {
        name: 'GPUPipelineError',
        reason,
      }) as unknown as GPUPipelineError)

/** Whether `error` is a pipeline error: by its class where the host has one, else (a host without it) by its name, so that classifying a refusal never throws. */
export const isPipelineError = (error: unknown): error is GPUPipelineError =>
  typeof GPUPipelineError !== 'undefined'
    ? error instanceof GPUPipelineError
    : error instanceof Error && error.name === 'GPUPipelineError'

/** Whether `error` is an instance of the host's error class `name`; false where the host lacks the class, so that classifying an error never throws. */
function isGpuError(
  name: 'GPUValidationError' | 'GPUOutOfMemoryError' | 'GPUInternalError',
  error: unknown,
) {
  const host = (globalThis as Record<string, unknown>)[name]
  return typeof host === 'function' && error instanceof host
}

/** What a scope of `filter` that caught an error says of a pipeline: only the validation scope tells a pipeline refused for what it is (its shader, entry point, layout or limits), which trying again answers the same; any other is tried again with the backoff. */
const reasonOfScope = (filter: GPUErrorFilter): GPUPipelineErrorReason =>
  filter === 'validation' ? 'validation' : 'internal'

/**
 * A device's error scope — validation by default —, opened around a resource creation. The device's
 * scopes are one stack every session shares, so a scope covers synchronous creation only: it is
 * popped as soon as the synchronous part of `build` returns, and a creation after an `await` of
 * `build` is outside it. The promise `build` returns is awaited here and its rejection thrown, as
 * the scope's own error when the scope holds one, over the rejection. A resource build keeps the error type the scope gave (`GPUValidationError`, `GPUOutOfMemoryError`,
 * `GPUInternalError`): only a pipeline build is mapped to `GPUPipelineError`, by `madeChecked`. The raw error is thrown as it is (it has no stack): `deviceOwners.ts` tells an
 * out-of-memory refusal by `instanceof GPUOutOfMemoryError`, and a test pins that a resource keeps its type, so it is not wrapped.
 */
export async function validationScope<T>(
  device: GPUDevice,
  build: () => T | Promise<T>,
  filter: GPUErrorFilter = 'validation',
): Promise<{ value: T; error: GPUError | null }> {
  const { made: built, popped } = scopedNow(device, filter, () =>
    constructGpuResources(device, build),
  )
  let value: T
  try {
    value = built instanceof Promise ? await built : built
  } catch (error) {
    // A released session's abort stays an abort; a pop the device refuses leaves the build's own reason.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    // The scope's own error wins over the build's rejection, as the error it is.
    throw (await popped.catch(none)) ?? error
  }
  return { value, error: await popped }
}

/**
 * `make`, a synchronous creation made after an `await`, under a validation scope of its own inside an out-of-memory one inside an internal one, all closed before `use(made)` starts. Resolves with `use`'s result; the error
 * any scope holds refuses it as a pipeline (`GPUPipelineError`, answered `refused` by `validatedOrWhy`), over any rejection: `validation` (refused for good) where the validation scope caught it,
 * `internal` (tried again) where the out-of-memory or the internal one did (a pipeline or its layout that the implementation fails to make is reported as an internal error).
 * Three scopes are pushed and popped per call, deliberately: they are what tells the three verdicts apart, and the cost falls on the synchronous fallback path only.
 */
export async function madeChecked<T, R>(
  device: GPUDevice,
  make: () => T,
  use: (made: T) => Promise<R>,
): Promise<R> {
  const {
    made: {
      made: { made, popped: validation },
      popped: memory,
    },
    popped: internal,
  } = scopedNow(device, 'internal', () =>
    scopedNow(device, 'out-of-memory', () => scopedNow(device, 'validation', make)),
  )
  const used = use(made)
  used.catch(none)
  // The three pops were issued together, innermost first: all are awaited, so that a pop the device rejects hides no error another scope captured.
  const scopes = ['validation', 'out-of-memory', 'internal'] as const
  const verdicts = await Promise.allSettled([validation, memory, internal])
  for (const [rank, verdict] of verdicts.entries()) {
    const error = verdict.status === 'fulfilled' ? verdict.value : null
    if (error) throw pipelineError(error.message, reasonOfScope(scopes[rank]!))
  }
  for (const verdict of verdicts) if (verdict.status === 'rejected') throw verdict.reason
  return used
}

/** What `build` made, or `undefined` when it made nothing or the device refused part of it — a
 *  pipeline compiled off the thread is refused by its promise, not in the scope. */
export async function validated<T>(
  device: GPUDevice,
  build: () => T | undefined | Promise<T | undefined>,
  filter: GPUErrorFilter = 'validation',
): Promise<T | undefined> {
  return (await validatedOrWhy(device, build, filter)).value
}

/** `validated`, with why the device refused: the scope's error, or the refused pipeline's, by its
 *  own message. A `build` that makes nothing is refused without a message of the device's. */
export async function validatedOrWhy<T>(
  device: GPUDevice,
  build: () => T | undefined | Promise<T | undefined>,
  filter: GPUErrorFilter = 'validation',
): Promise<{ value?: T; refused?: string }> {
  try {
    const { value, error } = await validationScope(device, build, filter)
    return error ? { refused: error.message } : { value }
  } catch (error) {
    // A pipeline refused, or a resource the scope of the asked filter caught (out of memory, internal): the device's answer, not a failure of the build.
    if (
      isGpuError('GPUValidationError', error) ||
      isPipelineError(error) ||
      isGpuError('GPUOutOfMemoryError', error) ||
      isGpuError('GPUInternalError', error)
    )
      return { refused: (error as Error).message }
    throw error
  }
}

/**
 * What `make` allocates when the device grants it, now: made under an out-of-memory scope, and
 * destroyed when refused, so a pool is only ever replaced by one the device holds (`poolGrants.ts`).
 */
export async function deviceMade<R extends { destroy(): void }>(
  device: GPUDevice,
  make: () => R,
): Promise<R | undefined> {
  const { value, error } = await validationScope(device, make, 'out-of-memory')
  if (!error) return value
  value.destroy()
  return undefined
}

/**
 * `make` asked of the device as `deviceMade` asks it — under the same out-of-memory scope —, for a
 * caller that cannot await the device's verdict, the frame's own grant: what `make` made, at once,
 * a throw thrown at once; and `refused` told of it if the device's verdict, which comes later,
 * refuses it. The scope opens and closes before this returns, nested in any scope still open.
 */
export function deviceMadeNow<R>(device: GPUDevice, make: () => R, refused: (made: R) => void): R {
  const { made, popped } = scopedNow(device, 'out-of-memory', () =>
    constructGpuResources(device, make),
  )
  void popped.then((error) => error && refused(made)).catch(none)
  return made
}

/** What the device is asked under `deviceMade` — a pool, the frame targets —, `settled` once done. */
export type DeviceGrant = { settled: boolean; done: Promise<void> }

/** `work` as a grant, `key` its record: settled once `work` is. */
export function startGrant<K extends object>(work: Promise<void>, key = {} as K) {
  const grant: K & DeviceGrant = Object.assign(key, { settled: false, done: work })
  grant.done = work.finally(() => (grant.settled = true))
  return grant
}

/** What the device still answers for `grant`, while it answers. */
export const grantPending = (grant: DeviceGrant | undefined) =>
  grant && !grant.settled ? grant.done : undefined
