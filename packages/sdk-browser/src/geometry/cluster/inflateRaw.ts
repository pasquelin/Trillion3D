/** Raw DEFLATE bytes inflated by the browser's own decompressor: no decoder downloaded. The bytes
 *  are a fetched body's or a view of one, never of shared memory. Past `most` bytes out it stops and
 *  throws, the rest never inflated. */
export async function inflateRaw(bytes: ArrayBuffer | Uint8Array, most = Infinity) {
  const body = bytes as BufferSource
  const reader = new Response(body)
    .body!.pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    length += read.value.byteLength
    if (length > most) {
      await reader.cancel()
      throw new RangeError(`inflates past ${most} bytes`)
    }
    chunks.push(read.value)
  }
  const inflated = new Uint8Array(length)
  chunks.reduce((at, chunk) => (inflated.set(chunk, at), at + chunk.byteLength), 0)
  return inflated
}
