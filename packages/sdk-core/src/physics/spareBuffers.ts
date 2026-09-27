/** Buffers kept for a writer to fill again: enough for the page's and the worker's in flight. */
const SPARE_BUFFERS = 4;

/**
 * The command buffers the worker handed back once it ran them. A take copies the words into a
 * spare that holds them, else into a new buffer rounded up to a power of two, so the next frames
 * reuse it; after the first frames, a flush allocates no buffer.
 */
export class SpareBuffers {
  private spare: ArrayBuffer[] = [];

  /** `words[0..length)` in a buffer of their own, the view exactly `length` words long. */
  copy(words: Uint32Array, length: number): Uint32Array<ArrayBuffer> {
    const bytes = length * 4,
      spare = this.spare;
    let at = spare.length - 1;
    while (at >= 0 && spare[at].byteLength < bytes) at--;
    let buffer: ArrayBuffer;
    if (at < 0) buffer = new ArrayBuffer(Math.max(4096, 2 ** Math.ceil(Math.log2(bytes))));
    else {
      buffer = spare[at];
      spare[at] = spare[spare.length - 1];
      spare.pop();
    }
    const out = new Uint32Array(buffer, 0, length);
    out.set(words.subarray(0, length));
    return out;
  }

  /** Buffers `copy` gave out, handed back once read; past `SPARE_BUFFERS`, left to the collector. */
  recycle(buffers: readonly ArrayBuffer[]) {
    for (const buffer of buffers) if (this.spare.length < SPARE_BUFFERS) this.spare.push(buffer);
  }
}
