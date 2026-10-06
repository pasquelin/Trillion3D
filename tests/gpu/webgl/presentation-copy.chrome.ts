// The engine carries a presented image away exactly, in Chrome: its synchronous capture copies the
// canvas through its own WebGL2 program, every channel unchanged — one channel off would mean a
// colour conversion crept back in — and its rows bottom first, the convention the SDK publishes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inChrome } from '../kit/onChrome.ts'
import type { execute } from './presentationCopyPage.ts'

const PAGE = resolve(import.meta.dirname, 'presentationCopyPage.ts')

test(
  'the synchronous capture copies a presented image byte for byte',
  { timeout: 60_000 },
  async () => {
    const result = await inChrome<ReturnType<typeof execute>>(PAGE, 'execute')
    console.log(JSON.stringify(result))
    assert.equal(result.bytes, 64 * 48 * 4)
    assert.equal(result.bytes, result.expectedBytes)
    assert.equal(
      result.differentChannels,
      0,
      `${result.differentChannels} channels differ (max ${result.maxChannelError})`,
    )
  },
)
