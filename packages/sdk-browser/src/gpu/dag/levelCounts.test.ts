// The readback carries the camera's requests counted by admission bucket (`levelCountsWord`): the
// host merges views by them (`../../webgpu/residency/readbackMerge.ts`). The main readback holds
// them behind the eviction burst; a view aside's slot right behind its two lists, where it holds
// no eviction queue.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDagOutput } from './uniforms.ts'
import {
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  evictionWord,
  levelCountsWord,
  residentReadbackBytes,
} from './layout.ts'
import { ADMISSION_BUCKETS } from './request.ts'

const CAP = 16

test("the main readback's counts are read behind its eviction burst", () => {
  const words = new Uint32Array(residentReadbackBytes(CAP) / 4)
  words[OUT_COUNT] = 3
  words.set([7, 8, 9], HEAD)
  words[evictionWord(CAP)] = 1
  words[evictionWord(CAP) + HEAD] = 42
  words[levelCountsWord(CAP) + 5] = 2
  words[levelCountsWord(CAP) + 36] = 1
  const levels = levelCountsWord(CAP),
    read = parseDagOutput(words.buffer, 0, words.byteLength, HEAD + CAP, undefined, levels)!
  assert.deepEqual(read.pageIds, [7, 8, 9])
  assert.deepEqual(read.evictPageIds, [42])
  assert.equal(read.levelCounts?.length, ADMISSION_BUCKETS)
  assert.deepEqual([read.levelCounts![5], read.levelCounts![36]], [2, 1])
})

test("a view aside's counts lie where an eviction queue would: it reads none", () => {
  const ranks = 4,
    drawn = HEAD + ranks
  const words = new Uint32Array(2 * drawn + ADMISSION_BUCKETS)
  words[OUT_COUNT] = 2
  words.set([1, 2], HEAD)
  words[2 * drawn] = 9
  const read = parseDagOutput(words.buffer, 0, words.byteLength, drawn, undefined, 2 * drawn)!
  assert.deepEqual(read.evictPageIds, [], 'no eviction queue')
  assert.equal(read.levelCounts![0], 9)
  assert.equal(parseDagOutput(words.buffer, 0, words.byteLength, drawn)!.levelCounts, undefined)
})
