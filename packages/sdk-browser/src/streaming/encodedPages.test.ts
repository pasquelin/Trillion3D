// Pages served with a `Content-Encoding`: the transport decodes them, and the streamer reads,
// sizes and fingerprints the page's own bytes, as it does an identity answer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { createPageStreamer } from './pageStreamer.ts'
import { sha256Hex } from './sha256Hex.ts'

const ENCODINGS = {
  br: brotliCompressSync,
  gzip: gzipSync,
  identity: (bytes: Uint8Array) => bytes,
}

test('a page sent brotli, gzip or as is reads the same bytes, sized and fingerprinted', async () => {
  const page = Uint8Array.from({ length: 12288 }, (_, i) => (i * 7) % 61)
  const sha256 = await sha256Hex(page.slice().buffer)
  const sent: Record<string, number> = {}
  const server = createServer((request, response) => {
    const encoding = request.url!.slice(1) as keyof typeof ENCODINGS
    const body = ENCODINGS[encoding](page)
    sent[encoding] = body.byteLength
    const header = encoding === 'identity' ? {} : { 'content-encoding': encoding }
    response.writeHead(200, { 'content-length': body.byteLength, ...header }).end(body)
  })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  const urls = Object.keys(ENCODINGS)
  const streamer = createPageStreamer(
    urls.map((url) => ({ url, bytes: page.byteLength, sha256 })),
    base,
  )
  try {
    for (const url of urls) assert.deepEqual(await streamer.readBytes(url), page, url)
    assert.ok(sent.br < page.byteLength && sent.gzip < page.byteLength, 'the pages were encoded')
    assert.equal(streamer.stats().bytesRead, 3 * page.byteLength, 'counted decoded')
    assert.equal(streamer.stats().failed, 0)
  } finally {
    streamer.dispose()
    server.closeAllConnections()
    server.close()
  }
})
