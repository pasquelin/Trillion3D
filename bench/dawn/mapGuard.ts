// Dawn in Node (webgpu 0.6.2) crashes the process (SIGBUS in `AsyncRunner::Reject`) when it rejects
// a promise, which it does when a buffer is destroyed or unmapped while a `mapAsync` on it waits —
// a browser only rejects the promise. A destroy or an unmap asked during a pending map is held until
// that map settles, so Dawn never has a map to reject: the buffer goes the same way, a little later.
type Held = { pending: Promise<unknown> | null; destroy: boolean };

/** Patches the buffer prototype `proto` once. */
export function guardMaps(proto: GPUBuffer) {
  const held = new WeakMap<GPUBuffer, Held>();
  const { mapAsync, destroy, unmap } = proto;
  proto.mapAsync = function (this: GPUBuffer, ...args: Parameters<GPUBuffer['mapAsync']>) {
    const state: Held = held.get(this) ?? { pending: null, destroy: false };
    const map = mapAsync.apply(this, args);
    state.pending = map;
    held.set(this, state);
    const settle = () => {
      if (state.pending !== map) return;
      state.pending = null;
      if (state.destroy) destroy.call(this);
    };
    map.then(settle, settle);
    return map;
  };
  proto.destroy = function (this: GPUBuffer) {
    const state = held.get(this);
    if (state?.pending) state.destroy = true;
    else destroy.call(this);
  };
  proto.unmap = function (this: GPUBuffer) {
    const state = held.get(this);
    // An unmap of a map still on its way cancels nothing here: the map lands, then the buffer is
    // the caller's to unmap again, as it would after the browser rejected the map.
    if (state?.pending) return;
    unmap.call(this);
  };
}
