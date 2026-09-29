/**
 * THE GROWTH OF A TABLE SIZED BY DRAWABLE ROW, IN TWO STEPS. Its new buffers are made first and
 * held apart — the device grants them under an out-of-memory scope while the old ones still live
 * (`../../webgpu/pages/prepare/growTables.ts`) —; only once every one is granted does `commit`
 * put them in place and free those they replace. `destroy` frees them and leaves the table as it
 * was: a refused growth changes nothing. `bytes` is what the new buffers hold.
 */
export type PendingGrowth = { bytes: number; commit(): void; destroy(): void };

/** One growth made of several: committed in their order, destroyed together. */
export function pendingAll(list: ReadonlyArray<PendingGrowth | undefined>): PendingGrowth {
  const held = list.filter((pending): pending is PendingGrowth => !!pending);
  return {
    bytes: held.reduce((total, pending) => total + pending.bytes, 0),
    commit: () => held.forEach((pending) => pending.commit()),
    destroy: () => held.forEach((pending) => pending.destroy()),
  };
}

/** The growth of `buffers`: `adopt` installs them and returns those they replace, then freed. */
export function pendingBuffers(
  buffers: readonly GPUBuffer[],
  adopt: () => readonly (GPUBuffer | undefined)[],
): PendingGrowth {
  return {
    bytes: buffers.reduce((total, buffer) => total + buffer.size, 0),
    commit: () => adopt().forEach((buffer) => buffer?.destroy()),
    destroy: () => buffers.forEach((buffer) => buffer.destroy()),
  };
}
