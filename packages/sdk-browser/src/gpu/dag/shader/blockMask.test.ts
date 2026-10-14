// A cluster block is `WORKGROUP_THREADS` pages and its draw mask `BLOCK_MASK_WORDS` words: every
// place the kernels give a block's mask follows the knob, never a block of sixty-four. The kernel's
// own functions run in Node (`wgslScope`), on a block of 128 pages.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { wgslScope } from '../../../page/cut/wgslPredicate.fixture.ts'
import { wgslConstants } from '../../../texture/shaderRule.fixture.ts'

test('a block of 128 pages takes four mask words, the frame’s mask behind the cut’s', () => {
  const scope = wgslScope(DAG_SELECTION_SHADER, {
    ...wgslConstants(DAG_SELECTION_SHADER),
    WORKGROUP_THREADS: 128,
    BLOCK_MASK_WORDS: 4,
    views: [{ clusterCount: 1000 }],
  })
  const fn = (name: string) => scope.fn(name) as (...args: number[]) => number
  const blocks = fn('blockCount')(),
    base = fn('drawMaskBase')()
  assert.equal(blocks, 8, 'a thousand pages, eight blocks')
  assert.equal(base, 2 * blocks, 'behind the block counts and offsets')
  // The cut's mask holds four words a block; the frame's starts past all of them, never inside.
  assert.equal(fn('liveMaskBase')(), base + 4 * blocks, 'the frame’s mask behind the cut’s')
  assert.equal(fn('liveMaskWord')(999), base + 4 * blocks + 31, 'page 999, the last word')
})

test('the drawn rank, the commit and the clear read the block’s mask words, not two', () => {
  // The three kernels that walk a block's mask name its words through the constant.
  for (const text of [
    'for(var w=drawMaskBase()+(i/WORKGROUP_THREADS)*BLOCK_MASK_WORDS;w<word;w++)',
    'let words=BLOCK_MASK_WORDS*blockCount();',
    'for(var k=0u;k<BLOCK_MASK_WORDS;k++)',
  ])
    assert.ok(DAG_SELECTION_SHADER.includes(text), text)
  assert.doesNotMatch(DAG_SELECTION_SHADER, /i&32u|blockCount\(\)\*4u|2u\*blockCount\(\)/)
})
