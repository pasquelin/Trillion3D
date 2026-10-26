// A cluster block is `WORKGROUP_THREADS` pages and its blended-cluster mask `BLOCK_MASK_WORDS`
// words: every place the kernels give a block's mask follows the knob, never a block of sixty-four.
// The kernel's own functions run in Node (`wgslScope`), on a block of 128 pages.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './selectionShader.fixture.ts'
import { wgslScope } from '../../cut/wgslPredicate.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'

test('a block of 128 pages takes four mask words, the post pass’s mask behind the frame’s', () => {
  const scope = wgslScope(DAG_SELECTION_SHADER, {
    ...wgslConstants(DAG_SELECTION_SHADER),
    WORKGROUP_THREADS: 128,
    BLOCK_MASK_WORDS: 4,
    cutView: { clusterCount: 1000 },
  })
  const fn = (name: string) => scope.fn(name) as (...args: number[]) => number
  const blocks = fn('blockCount')()
  assert.equal(blocks, 8, 'a thousand pages, eight blocks')
  assert.equal(fn('drawMaskBase')(), 0, 'the frame’s mask opens `work`')
  // The frame's mask holds four words a block; the post pass's starts past all of them, never inside.
  assert.equal(fn('postMaskBase')(), 4 * blocks, 'the post pass’s mask behind the frame’s')
  assert.equal(fn('counterBase')(), 8 * blocks, 'the frame counters behind both masks')
  assert.equal(fn('postMaskWord')(999), 4 * blocks + 31, 'page 999, the last word')
})

test('the prepare kernel clears the block’s mask words, not two', () => {
  // The kernel that resets a block's masks names its words through the constant.
  assert.ok(
    DAG_SELECTION_SHADER.includes(
      'atomicStore(&work[drawMaskBase()+BLOCK_MASK_WORDS*i+k],0u);atomicStore(&work[postMaskBase()+BLOCK_MASK_WORDS*i+k],0u);',
    ),
  )
  assert.doesNotMatch(DAG_SELECTION_SHADER, /i&32u|blockCount\(\)\*4u|2u\*blockCount\(\)/)
})
