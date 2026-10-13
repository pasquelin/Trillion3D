import { retire } from './frameRetire.ts'

/**
 * THE GROWTH OF A RESOURCE BY COPY, IN TWO STEPS — a table sized by drawable row, the cut's lists,
 * the vertex pool, the shadow tables, the page pool. Its new buffers are made first and
 * held apart — the device grants them under an out-of-memory scope while the old ones still live
 * (`../../webgpu/pages/prepare/growTables.ts`) —; only once every one is granted does `commit`
 * put them in place and retire those they replace. `destroy` frees them and leaves the table as it
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

/** A resource a growth frees — a buffer, a texture, a pool of them —, or none where none was held. */
type Freed = { destroy(): void } | undefined

/**
 * The growth of `made`, `bytes` large, on `device`: `adopt` installs it and returns what it
 * replaces, which is retired — commands of this image not yet submitted may name it, so it is
 * destroyed after the frame's submit (`frameRetire.ts`) —; `destroy` frees `made` at once instead,
 * never named by any command. The one transaction of every resource grown by copy: made aside,
 * copied, swapped in, the old retired — or freed itself, the old kept.
 */
export function pendingMade(
  device: GPUDevice,
  made: readonly Freed[],
  bytes: number,
  adopt: () => readonly Freed[],
): PendingGrowth {
  return {
    bytes,
    commit: () => adopt().forEach((held) => held && retire(device, held)),
    destroy: () => made.forEach((resource) => resource?.destroy()),
  }
}

/** The growth of `buffers`: `adopt` installs them and returns those they replace, then retired. */
export const pendingBuffers = (
  device: GPUDevice,
  buffers: readonly GPUBuffer[],
  adopt: () => readonly Freed[],
) =>
  pendingMade(
    device,
    buffers,
    buffers.reduce((total, buffer) => total + buffer.size, 0),
    adopt,
  )
