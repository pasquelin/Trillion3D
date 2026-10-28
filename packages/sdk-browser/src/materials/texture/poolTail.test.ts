// The decision to read a tail's RGBA8 levels is `poolTail`'s own: the cache that keeps them in a
// file of their own loads them exactly where `tailReadsLevels` says, and a tail not loaded is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { PREVIEW_STORED_LAYOUTS } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { POOL_LANES, type ChannelPool, type PoolSettings } from './blockFormats.ts'
import { poolTail, tailReadsLevels } from './poolTail.ts'

const BLOCKS = [undefined, 'bc7', 'astc', 'etc2'] as const
const CHANNEL_POOLS: ChannelPool[] = ['two', 'bc4', 'r8', 'r16', 'r32']
const SIZE = { width: 4, height: 4, tail: 0 }

/** Every settings, lane and stored layout a session can meet. */
function* combinations() {
  for (const block of BLOCKS)
    for (const hdrBlocks of [false, true])
      for (const channelPool of CHANNEL_POOLS)
        for (const hdr32 of [false, true])
          for (const lane of POOL_LANES)
            for (const stored of PREVIEW_STORED_LAYOUTS)
              yield {
                settings: { block, hdrBlocks, channelPool, hdr32 } as PoolSettings,
                lane,
                layouts: { bc7: stored, astc: stored, etc2: stored },
              }
}

test('poolTail reads the levels of a tail exactly where tailReadsLevels says', () => {
  for (const { settings, lane, layouts } of combinations()) {
    let touched = false
    const levels = new Proxy([new Uint8Array(4)], {
      get(target, key, receiver) {
        touched = true
        return Reflect.get(target, key, receiver)
      },
    })
    const tail = { levels, blocks: { bc7: [], astc: [], etc2: [] }, layouts, atlas: 0 }
    const label = JSON.stringify({ settings, lane, stored: layouts.bc7 })
    const reads = tailReadsLevels(settings, tail, lane)
    // The levels are whole here: nothing throws for want of them, and they are touched only when read.
    try {
      poolTail(settings, tail, lane, SIZE)
    } catch (error) {
      assert.ok(!(error instanceof EngineError), label)
    }
    assert.equal(touched, reads, label)
  }
})

test('a tail whose levels were not loaded is refused where it would read them, never pinned empty', () => {
  for (const { settings, lane, layouts } of combinations()) {
    const tail = {
      levels: [new Uint8Array(0)],
      blocks: { bc7: [], astc: [], etc2: [] },
      layouts,
      atlas: 0,
    }
    const label = JSON.stringify({ settings, lane, stored: layouts.bc7 })
    const refused = (() => {
      try {
        poolTail(settings, tail, lane, SIZE)
        return false
      } catch (error) {
        return error instanceof EngineError && error.code === 'INVALID_CACHE'
      }
    })()
    assert.equal(refused, tailReadsLevels(settings, tail, lane), label)
  }
})
