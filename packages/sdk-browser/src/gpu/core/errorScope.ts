/**
 * A device's error scope — validation by default —, opened around a resource creation. The device's scopes are one
 * stack every session shares: a scope left open takes the errors of the next session, a scope
 * closed twice takes another's. So `build` runs inside the scope, and the scope is closed once in
 * every case, a throw included — the `AbortError` of a session released mid-build among them.
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
  device.pushErrorScope(filter);
  let value: T;
  try {
    // A build that returns at once is popped at once: no other scope opens between its push and
    // its pop, so two grants started in one frame never take each other's errors.
    const built = build();
    value = built instanceof Promise ? await built : built;
  } catch (error) {
    await device.popErrorScope().catch(() => null);
    throw error;
  }
  return { value, error: await device.popErrorScope() };
}

/** What `build` made, or `undefined` when it made nothing or the device refused part of it. */
export async function validated<T>(
  device: GPUDevice,
  build: () => T | undefined | Promise<T | undefined>,
): Promise<T | undefined> {
  const { value, error } = await validationScope(device, build);
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
