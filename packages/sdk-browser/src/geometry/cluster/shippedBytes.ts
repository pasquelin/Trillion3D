/**
 * The loading of a file shipped beside a module, shared by what reads one (the blue noise, the skin table,
 * the kernels). It imports nothing but the HTTP loader (`checked`), so a worker loads it alone.
 */
import { checked } from './checked.ts'

/** The bytes of a shipped file, or a function that reads them: the host may supply them — that is what Node does,
 *  which cannot follow a file URL with `fetch`. */
export type ByteSource = BufferSource | (() => Promise<BufferSource>)

/** The file at `url` as a page fetches it: beside the module, by its URL (`new URL('./x.bin', import.meta.url).href`,
 *  written where the file lies, for the bundler to find it). */
export async function shippedBytes(url: string): Promise<BufferSource> {
  const response = await checked(url)
  return await response.arrayBuffer()
}

/** The bytes `source` gives, as a byte view. */
export async function sourceBytes(source: ByteSource): Promise<Uint8Array> {
  const data = typeof source === 'function' ? await source() : source
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data)
}
