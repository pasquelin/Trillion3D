import { KEY_PAGE_MAX } from '../../gpu/dag/evict.ts'

/** A buffer of bytes that is resized in place, up to the pages a key word names. */
type ResizableBuffer = ArrayBuffer & { resize(bytes: number): void }
const ResizableBuffer = ArrayBuffer as unknown as new (
  bytes: number,
  options: { maxByteLength: number },
) => ResizableBuffer

/**
 * The holders of each page key of the root cover, one byte a key (`coverHolders.ts`), in a table
 * that grows with the catalogue and keeps its identity: every reader holds this one array, and a
 * key a source added to the session brings (`growCoverKeys`) reads and counts in it at once, the
 * keys it held untouched. Its length follows its buffer's.
 */
export function createCoverKeys(count: number): Uint8Array {
  return new Uint8Array(new ResizableBuffer(count, { maxByteLength: KEY_PAGE_MAX }))
}

/** `keys` holds `count` keys at least; the new ones are held by none. */
export function growCoverKeys(keys: Uint8Array, count: number) {
  if (count > keys.length) (keys.buffer as ResizableBuffer).resize(count)
}
