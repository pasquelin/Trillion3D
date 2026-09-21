import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import {
  ATTRS,
  ATTR_BASE,
  DECODED,
  ERROR,
  FLAGS,
  ID,
  MAX_SHARED_ATTRS,
  SHARED_BY_REGION,
  SHARED_READY,
  SHARED_REGION_BYTES,
  STATE,
  STATUS,
  TASK_US,
  VERTEX,
  WASM,
  regionAt,
  slotField,
} from './pageDecodeShared.ts';
import type { PageArena } from './pageDecodeShared.ts';
import type { PageDecodeDone } from '../sdk-core/index.ts';

/**
 * A decoded page in a slot's region, and the same page reread by the main thread.
 *
 * The region carries the page's block — the indices, then each attribute in decode order —,
 * then the attribute names in UTF-8. Lengths live in the control zone; names travel as-is
 * rather than deduced from flags, so a new attribute obliges nothing here. The quantization
 * error crosses as the bits of its 32-bit float.
 */
const encoder = new TextEncoder(),
  decoder = new TextDecoder(),
  errorBits = new Float32Array(1),
  errorWord = new Int32Array(errorBits.buffer);

/**
 * Writes the page and publishes the slot. False — without writing anything — when it does not
 * fit in the region or carries more attributes than the plan: the caller then takes the
 * transfer path, which returns exactly the same bytes.
 */
export function writeSharedPage(arena: PageArena, slot: number, done: PageDecodeDone) {
  const page = done.decoded;
  if (!page || page.names.length > MAX_SHARED_ATTRS) return false;
  const names = page.names.map((name) => encoder.encode(name));
  let bytes = page.block.byteLength;
  for (const name of names) bytes += name.byteLength;
  if (bytes > SHARED_REGION_BYTES) return false;
  const region = new Uint8Array(arena.buffer, regionAt(arena, slot), bytes);
  let offset = 0;
  const put = (source: Uint8Array) => {
    region.set(source, offset);
    offset += source.byteLength;
  };
  put(new Uint8Array(page.block));
  for (const name of names) put(name);
  const control = arena.control,
    base = slotField(slot, 0);
  control[base + VERTEX] = page.vertexCount;
  control[base + FLAGS] = page.flags;
  control[base + DECODED] = page.decodedBytes;
  control[base + WASM] = done.wasm ? 1 : 0;
  control[base + TASK_US] = Math.round(done.taskMs * 1000);
  errorBits[0] = page.quantizationError;
  control[base + ERROR] = errorWord[0];
  control[base + ATTRS] = names.length;
  for (let k = 0; k < names.length; k++) control[base + ATTR_BASE + k] = names[k].byteLength;
  // These two atomic writes publish everything that precedes: a reader that sees `ready` also
  // sees the region and the lengths, whole.
  Atomics.store(control, base + STATUS, SHARED_BY_REGION);
  Atomics.store(control, base + STATE, SHARED_READY);
  Atomics.notify(control, base + STATE);
  return true;
}

/** Bytes of a slice of the region, copied into a buffer of one's own. The region is reused as
 *  soon as the slot is free again: nothing that leaves here can remain a view on it. */
function copyOut(arena: PageArena, offset: number, bytes: number) {
  const copy = new Uint8Array(bytes);
  copy.set(new Uint8Array(arena.buffer, offset, bytes));
  return copy.buffer as ArrayBuffer;
}

/**
 * The page published in a slot, reread as a contract answer; the slot is released afterwards.
 * The returned buffers are those of an ordinary answer: the caller does not see which way the
 * page went.
 */
export function readSharedPage(arena: PageArena, slot: number): PageDecodeDone {
  const control = arena.control,
    base = slotField(slot, 0);
  const count = control[base + ATTRS];
  let offset = regionAt(arena, slot);
  const block = copyOut(arena, offset, control[base + DECODED]);
  offset += control[base + DECODED];
  const names: string[] = [];
  for (let k = 0; k < count; k++) {
    const bytes = control[base + ATTR_BASE + k];
    names.push(decoder.decode(new Uint8Array(copyOut(arena, offset, bytes))));
    offset += bytes;
  }
  errorWord[0] = control[base + ERROR];
  const done: PageDecodeDone = {
    protocol: PAGE_DECODE_PROTOCOL,
    id: control[base + ID],
    ok: true,
    sha256: null,
    source: null,
    decoded: {
      block,
      names,
      vertexCount: control[base + VERTEX],
      flags: control[base + FLAGS],
      decodedBytes: control[base + DECODED],
      quantizationError: errorBits[0],
    },
    wasm: control[base + WASM] === 1,
    // Task time crosses the control zone as whole microseconds: a counter, never a frame value.
    taskMs: control[base + TASK_US] / 1000,
  };
  return done;
}
