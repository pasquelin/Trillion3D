// A file is served as a server serves it: the whole of it, or a part by a `Range`, 206 with its `content-range`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { fileResponse } from './fileFetch.ts'

test('a range of a file is a 206 with the bytes and their place; no range, the whole file', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'file-fetch-')), 'bytes.bin')
  writeFileSync(file, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
  const href = pathToFileURL(file).href
  const part = await fileResponse(href, 'bytes=2-4')
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-range'), 'bytes 2-4/10')
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [2, 3, 4])
  const tail = await fileResponse(href, 'bytes=8-')
  assert.deepEqual([...new Uint8Array(await tail.arrayBuffer())], [8, 9])
  const past = await fileResponse(href, 'bytes=20-30')
  assert.equal(past.status, 416)
  const whole = await fileResponse(href, null)
  assert.equal(whole.status, 200)
  assert.equal((await whole.arrayBuffer()).byteLength, 10)
})
