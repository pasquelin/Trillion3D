/**
 * Releases a result nobody will receive: its own `dispose` first, then the host's hook, each on
 * its own. Neither can fail the caller: a job's status is already decided when this runs.
 */
export function disposeOwned<T>(value: T, hook: (result: T) => void) {
  try {
    // Read once: a getter may hand out the disposer a single time, and may throw. `Object` gives
    // `null` and the primitives a disposer-less object.
    const dispose = (Object(value) as { dispose?: unknown }).dispose;
    if (typeof dispose === 'function') dispose.call(value);
  } catch {
    /* Disposal cannot change job status, including a disposer that cannot be read. */
  }
  try {
    hook(value);
  } catch {
    /* Host disposal hooks cannot change job status. */
  }
}
