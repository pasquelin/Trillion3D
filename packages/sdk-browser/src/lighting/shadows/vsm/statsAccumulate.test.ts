import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VSM_ACCUMULATE_MAX_FRAMES,
  VSM_STAT_NAMES,
  accumulateStep,
  vsmStatsCsv,
  type VsmAccumulation,
} from './statsAccumulate.ts'
import { VSM_STATS_WORDS } from './constants.ts'

const run = (setting: number, frames: number) => {
  const state: VsmAccumulation = { asked: 0, left: 0 }
  let running = false
  const steps: string[] = []
  for (let k = 0; k < frames; k++) {
    const step = accumulateStep(state, setting, running)
    running = step === 'copy' ? true : step === 'finish' ? false : running
    steps.push(step)
  }
  return steps
}

test('a count of N takes N frames, then finishes once', () => {
  assert.deepEqual(run(3, 6), ['copy', 'copy', 'copy', 'finish', 'idle', 'idle'])
})

test('a negative setting goes on, 0 does nothing', () => {
  assert.deepEqual(run(-1, 3), ['copy', 'copy', 'copy'])
  assert.deepEqual(run(0, 2), ['idle', 'idle'])
})

test('setting back to 0 finishes a running accumulation', () => {
  const state: VsmAccumulation = { asked: 0, left: 0 }
  assert.equal(accumulateStep(state, -1, false), 'copy')
  assert.equal(accumulateStep(state, 0, true), 'finish')
  assert.equal(accumulateStep(state, 0, false), 'idle')
})

test('a new value restarts the count', () => {
  const state: VsmAccumulation = { asked: 0, left: 0 }
  assert.equal(accumulateStep(state, 1, false), 'copy')
  assert.equal(accumulateStep(state, 1, true), 'finish')
  assert.equal(accumulateStep(state, 2, false), 'copy')
  assert.equal(accumulateStep(state, 2, true), 'copy')
})

test('the stats have one name a word, and the CSV holds a line a frame', () => {
  assert.equal(VSM_STAT_NAMES.length, VSM_STATS_WORDS)
  assert.ok(VSM_STAT_NAMES.every((name) => name && name === name.toUpperCase()))
  const words = new Uint32Array(1 + 2 * VSM_STATS_WORDS)
  words[0] = 2
  words.fill(7, 1, 1 + VSM_STATS_WORDS)
  words.fill(9, 1 + VSM_STATS_WORDS)
  const lines = vsmStatsCsv(words).split('\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0], VSM_STAT_NAMES.join(','))
  assert.equal(lines[1], new Array(VSM_STATS_WORDS).fill(7).join(','))
  assert.equal(lines[2], new Array(VSM_STATS_WORDS).fill(9).join(','))
})

test('rows past the buffer, or past the words read, are not listed', () => {
  const words = new Uint32Array(1 + VSM_STATS_WORDS)
  words[0] = VSM_ACCUMULATE_MAX_FRAMES + 5
  assert.equal(vsmStatsCsv(words).split('\n').length, 2)
})
