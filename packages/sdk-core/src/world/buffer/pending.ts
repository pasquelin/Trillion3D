/**
 * Vertex numbers held now or read later. A loaded mesh's vertices are not fetched at session start:
 * its attributes hold pending numbers until `Geometry.loadVertices` reads them, and a synchronous
 * read before then is refused by name, never answered with an empty array.
 */
import { EngineError } from '../../contracts/cache.ts';
import type { BufferTypedArray } from './elements.ts';

/** Numbers read on first need: a loaded mesh's vertices, which no session fetches up front
 *  (`Geometry.loadVertices`). `read` is called once, however many loads ask. */
export type PendingNumbers = {
  readonly length: number;
  readonly type: string;
  read(): Promise<BufferTypedArray>;
};

/** Holder of numbers now or later: an attribute owning them, or an interleaved buffer. */
type Held = {
  _numbers: BufferTypedArray | null;
  _pending: { readonly length: number; read(): Promise<BufferTypedArray> } | null;
};

/** The named refusal of a synchronous read before the numbers are loaded. */
export function notLoaded(): never {
  throw new EngineError(
    'VERTICES_NOT_LOADED',
    "A loaded mesh's vertices are read after `await geometry.loadVertices()`.",
  );
}

/** Reads pending numbers into their holder; at once when they are there. */
export async function load(held: Held) {
  held._numbers ??= await held._pending!.read();
}

/** `held` with `numbers` in place of its own, read once however many loads ask. */
export function defer<T extends Held>(held: T, numbers: PendingNumbers): T {
  let reading: Promise<BufferTypedArray> | undefined;
  held._numbers = null;
  held._pending = { length: numbers.length, read: () => (reading ??= numbers.read()) };
  return held;
}
