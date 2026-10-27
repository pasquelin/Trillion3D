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

/** The refusal the scope `popped` holds, if any: its message wins over whatever its work settled to. */
async function scopeRefusal(popped: Promise<GPUError | null>) {
  const error = await popped
  return error ? pipelineRefusedBy(error.message) : undefined
}

/**
 * A device's error scope — validation by default —, opened around a resource creation. The device's
 * scopes are one stack every session shares, so a scope covers synchronous creation only: it is
 * popped as soon as the synchronous part of `build` returns, and a creation after an `await` of
 * `build` is outside it. The promise `build` returns is awaited here and its rejection thrown, as
 * the refusal of the scope's error when the scope holds one.
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
    throw (await scopeRefusal(popped).catch(() => undefined)) ?? error
  }
  return { value, error: await popped }
}

/**
 * `make`, a synchronous creation made after an `await`, under a scope of its own closed before
 * `use(made)` starts. Resolves with `use`'s result; the scope's error, when it holds one, refuses
 * it as a pipeline (`GPUPipelineError`, answered `refused` by `validatedOrWhy`), over any rejection.
 */
export async function madeChecked<T, R>(
  device: GPUDevice,
  make: () => T,
  use: (made: T) => Promise<R>,
): Promise<R> {
  const { made, popped } = scopedNow(device, 'validation', make)
  const used = use(made)
  used.catch(none)
  const refusal = await scopeRefusal(popped)
  if (refusal) throw refusal
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
    if (pipelineRefused(error)) return { refused: (error as GPUPipelineError).message }
    throw error
  }
}

/** A pipeline the device refused to compile off the thread (`GPUPipelineError`). */
const pipelineRefused = (error: unknown) => error instanceof GPUPipelineError

/** The refusal of a pipeline the device's scope reported, as the device refuses one off the thread. */
const pipelineRefusedBy = (message: string) =>
  new GPUPipelineError(message, { reason: 'validation' })

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
