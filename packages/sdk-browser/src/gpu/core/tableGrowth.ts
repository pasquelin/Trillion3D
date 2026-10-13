/**
 * THE GROWTH OF A RESOURCE BY COPY, IN TWO STEPS — a table sized by drawable row, the cut's lists,
 * the vertex pool, the shadow tables, the page pool. Its new buffers are made first and
 * held apart — the device grants them under an out-of-memory scope while the old ones still live
 * (`../../webgpu/pages/prepare/growTables.ts`) —; only once every one is granted does `commit`
 * put them in place and free those they replace. `destroy` frees them and leaves the table as it
 * was: a refused growth changes nothing. `bytes` is what the new buffers hold.
 */
export type PendingGrowth = { bytes: number; commit(): void; destroy(): void }

/** One growth made of several: committed in their order, destroyed together. */
export function pendingAll(list: ReadonlyArray<PendingGrowth | undefined>): PendingGrowth {
  const held = list.filter((pending): pending is PendingGrowth => !!pending)
  return {
    bytes: held.reduce((total, pending) => total + pending.bytes, 0),
    commit: () => held.forEach((pending) => pending.commit()),
    destroy: () => held.forEach((pending) => pending.destroy()),
  }
}

/**
 * The growth of `made`, `bytes` large: `adopt` installs it and returns what it replaces, which
 * `free` then frees; `destroy` frees `made` instead. The one transaction of every resource grown by
 * copy: made aside, copied, swapped in, the old freed — or freed itself, the old kept.
 */
export function pendingMade<T>(
  made: T,
  bytes: number,
  free: (held: T) => void,
  adopt: () => T,
): PendingGrowth {
  return { bytes, commit: () => free(adopt()), destroy: () => free(made) }
}

const destroyAll = (buffers: readonly (GPUBuffer | undefined)[]) =>
  buffers.forEach((buffer) => buffer?.destroy())

/** The growth of `buffers`: `adopt` installs them and returns those they replace, then freed. */
export const pendingBuffers = (
  buffers: readonly GPUBuffer[],
  adopt: () => readonly (GPUBuffer | undefined)[],
): PendingGrowth =>
  pendingMade<readonly (GPUBuffer | undefined)[]>(
    buffers,
    buffers.reduce((total, buffer) => total + buffer.size, 0),
    destroyAll,
    adopt,
  )
