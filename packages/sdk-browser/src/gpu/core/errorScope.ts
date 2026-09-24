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
    value = await build();
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
 * True when the device grants, now, what `allocate` creates: made under an out-of-memory scope,
 * then destroyed whatever the verdict. What a pool asks for is probed this way before the pool is
 * replaced, so a refusal leaves the pool in place instead of an invalid one (`poolGrants.ts`).
 */
export async function deviceGrants(
  device: GPUDevice,
  allocate: () => ReadonlyArray<{ destroy(): void }>,
): Promise<boolean> {
  const { value, error } = await validationScope(device, allocate, 'out-of-memory');
  for (const resource of value) resource.destroy();
  return !error;
}
