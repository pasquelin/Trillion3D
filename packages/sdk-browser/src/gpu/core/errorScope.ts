import { sharedGpuDevice } from './sessionHandle.ts';

/** Per device, the scope open now, released once it is popped. */
const openScopes = new WeakMap<GPUDevice, Promise<void>>();

/**
 * A device's error scope — validation by default —, opened around a resource creation. The device's scopes are one
 * stack every session shares: a scope left open takes the errors of the next session, a scope
 * closed twice takes another's. So `build` runs inside the scope, and the scope is closed once in
 * every case, a throw included — the `AbortError` of a session released mid-build among them.
 * One scope is open per device at a time: a build that awaits — a shader compiled — holds the
 * next one back until it is popped, and a device with no scope open runs its build at once.
 * A device that cannot open a scope proves no error: nothing is refused on that account, and the
 * caller keeps the path it would have kept.
 */
export async function validationScope<T>(
  device: GPUDevice,
  build: () => T | Promise<T>,
  filter: GPUErrorFilter = 'validation',
): Promise<{ value: T; error: GPUError | null }> {
  if (typeof device.pushErrorScope !== 'function' || typeof device.popErrorScope !== 'function')
    return { value: await build(), error: null };
  const shared = sharedGpuDevice(device),
    before = openScopes.get(shared);
  let release = () => {};
  const mine = new Promise<void>((resolve) => (release = resolve));
  openScopes.set(shared, mine);
  if (before) await before;
  let built: { value: T } | { error: unknown };
  device.pushErrorScope(filter);
  try {
    const made = build();
    built = { value: made instanceof Promise ? await made : made };
  } catch (error) {
    built = { error };
  }
  const popped = device.popErrorScope();
  if (openScopes.get(shared) === mine) openScopes.delete(shared);
  release();
  if ('error' in built) {
    await popped.catch(() => null);
    throw built.error;
  }
  return { value: built.value, error: await popped };
}

/** What `build` made, or `undefined` when it made nothing or the device refused part of it. */
export async function validated<T>(
  device: GPUDevice,
  build: () => T | undefined | Promise<T | undefined>,
  filter: GPUErrorFilter = 'validation',
): Promise<T | undefined> {
  const { value, error } = await validationScope(device, build, filter);
  return error ? undefined : value;
}

/**
 * What `make` allocates when the device grants it, now: made under an out-of-memory scope, and
 * destroyed when refused, so a pool is only ever replaced by one the device holds (`poolGrants.ts`).
 */
export async function deviceMade<R extends { destroy(): void }>(
  device: GPUDevice,
  make: () => R,
): Promise<R | undefined> {
  const { value, error } = await validationScope(device, make, 'out-of-memory');
  if (!error) return value;
  value.destroy();
  return undefined;
}

/** What the device is asked under `deviceMade` — a pool, the frame targets —: `settled` once it
 *  answered, and `done` then. */
export interface DeviceGrant {
  settled: boolean;
  done: Promise<void>;
}

/** `work` as a grant, `key` its record: settled once `work` is. */
export function startGrant<K extends object>(work: Promise<void>, key = {} as K) {
  const grant: K & DeviceGrant = Object.assign(key, { settled: false, done: work });
  grant.done = work.finally(() => (grant.settled = true));
  return grant;
}

/** What the device still answers for `grant`, while it answers. */
export const grantPending = (grant: DeviceGrant | undefined) =>
  grant && !grant.settled ? grant.done : undefined;
