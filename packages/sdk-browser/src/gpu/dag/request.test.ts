// BROADCAST request: the page and its priority, staged as two words, and the order it gives.
//
// Requests rank by the SUBSTITUTE's screen error — a missing cluster is drawn by a coarser
// ancestor, and that ancestor's error is what the eye sees. The WebGPU path published them in the
// order of an atomic counter, i.e. in none. This test holds both halves:
// ① the staged pair yields what was put in it, and quantification never reverses two errors;
// ② the order the kernel's model publishes follows `clusterErrorPixels`, on the same scene; the
// shipped kernel is held to it on a device (`tests/gpu/dag/request-order.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { REQUEST_PRIORITY_MAX, REQUEST_STEP_MAX } from './request.ts'
import { orderFault, REQUEST_STEP, requestScene, substitutePixels } from './requestScene.fixture.ts'
import {
  quantizeAheadPriority,
  quantizeRequestPriority,
  requestRank,
  stagedPage,
  stagedPriority,
  stagedRequest,
} from './request.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'

test('a staged request yields the page and the priority put in it, the page a whole word', () => {
  // Past the twenty-two bits a word shared with the priority held: an open world's instances.
  for (const page of [0, 1, 4095, 1959791, 2 ** 22, 2 ** 32 - 1])
    for (const priority of [0, 1, 512, REQUEST_PRIORITY_MAX]) {
      const staged = stagedRequest(page, priority)
      assert.equal(stagedPage(staged), page, `page ${page} / priority ${priority}`)
      assert.equal(stagedPriority(staged), priority, `page ${page} / priority ${priority}`)
    }
})

test('quantification is monotone: it never reverses two errors', () => {
  const errors = [0, 0.001, 0.01, 0.1, 0.5, 1, 2, 4, 16, 64, 256, 4096, 65536, Infinity]
  let precedent = -1
  for (const pixels of errors) {
    const q = quantizeRequestPriority(pixels)
    assert.ok(q >= precedent, `${pixels} px : ${q} < ${precedent}`)
    assert.ok(q >= 0 && q <= REQUEST_PRIORITY_MAX, `${pixels} px outside bounds : ${q}`)
    precedent = q
  }
  // A null or absurd error never goes ahead of a real error.
  assert.equal(quantizeRequestPriority(0), 0)
  assert.equal(quantizeRequestPriority(-1), 0)
  assert.equal(quantizeRequestPriority(NaN), 0)
  assert.equal(quantizeRequestPriority(Infinity), REQUEST_STEP_MAX)
})

test('every visible request outranks every request ahead, served soonest first, then by error', () => {
  // The costliest absence ahead against the cheapest one on screen: the deadline decides first.
  const visible = (pixels: number) => requestRank(quantizeRequestPriority(pixels))
  const ahead = (pixels: number, due: number) => requestRank(quantizeAheadPriority(pixels, due))
  assert.ok(visible(0) > ahead(Infinity, 0))
  assert.equal(ahead(NaN, 1), 0, 'the least a request can rank')
  assert.equal(visible(Infinity), REQUEST_PRIORITY_MAX, 'the most a request can rank')
  // Within the tier ahead: the sooner needed first, whatever its error, then the larger error.
  assert.ok(ahead(1, 0.1) > ahead(1e6, 0.9))
  assert.ok(ahead(64, 0.5) > ahead(4, 0.5))
  assert.equal(ahead(4, NaN), ahead(4, 1), 'a deadline that is no number is the latest')
  assert.equal(ahead(4, -1), ahead(4, 0), 'and one already past is now')
})

test('published order decreases with the substitute’s screen error (`clusterErrorPixels`)', () => {
  const scene = requestScene(1),
    reading = evaluateDagSelectionKernel(scene.packed, scene.uni)
  assert.ok(reading.pageIds.length > 100, 'the cut must keep enough to rank')
  const pixels = reading.pageIds.map(substitutePixels(scene))
  assert.ok(new Set(pixels.map((p) => p.toFixed(3))).size > 8, 'the cut must carry varied errors')
  const fault = orderFault(pixels)
  assert.equal(fault, -1, `rank ${fault}: ${pixels[fault]} px past ${pixels[fault - 1]} px`)
  // And the first is indeed the most costly absence of the whole cut, to the step.
  assert.ok(pixels[0] * REQUEST_STEP >= Math.max(...pixels), 'the head is not the most expensive')
})
