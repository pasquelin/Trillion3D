// A wanted page that is not resident yet does not throw GPU selection away. The scene's residency
// budget is too small for its leaves, so the kernel asks for missing pages and the cut climbs to
// the resident ancestor. Such a frame once raised `GPU_COVERAGE_INCOMPLETE` and GPU selection was
// abandoned for the session, `cpuSelectMs` turning from null to a duration without the host being
// told: the GPU cut must still choose, and no fallback be declared.
//
// No hole (#483 rule 1): on every frame the drawn cut covers each leaf of the strip exactly once —
// none uncovered, none twice. The check reads the drawn cut, not a counter, so it fails on a hole:
// dropping the `!childResident` term of the cut rule (`page/cut/rule.ts`, WGSL) leaves the leaves
// the budget refuses uncovered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { coverFault } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Reading = Awaited<ReturnType<typeof import('./heldGpuCutPage.ts').runHeldCut>>

test('the GPU cut keeps choosing over missing pages, and covers each leaf once', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'heldGpuCutPage.ts'),
    'heldGpuCut',
    'runHeldCut',
  )) as Reading
  console.log(JSON.stringify({ adapter: reading.adapter, frames: reading.frames }))
  assertSoundProof(reading)
  const frames = reading.frames ?? []
  assert.equal(frames.length, 30, 'thirty frames after load')
  const strip = { leaves: 4, pages: reading.pages ?? [] }
  const rankOf = new Map(strip.pages.map((page, rank) => [page.url, rank]))
  const rank = (url: string) => {
    const found = rankOf.get(url)
    if (found === undefined) throw new Error(`drawn page ${url} is not a page of the strip`)
    return found
  }
  /** The first leaf the drawn cut covers zero times or twice, or -1. */
  const hole = (drawn: readonly string[]) => coverFault(strip, drawn.map(rank))
  // The check bites: a cut missing one of its pages, or drawing a page with its ancestor, fails.
  const first = frames[0]?.drawn ?? []
  assert.ok(first.length > 0, 'the first frame draws a cut')
  assert.notEqual(hole(first.slice(1)), -1, 'a missing page must read as a hole')
  assert.notEqual(hole([...first, 'root']), -1, 'a page with its ancestor must read as overdraw')
  // The engine raises the pool to its floor — the root cover and the pages the root groups replace
  // (#1237) —: residency is still the bottleneck while it stays at that floor, below the strip's
  // pages.
  const events = reading.events ?? []
  const floor = events.find((e) => e.phase === 'minimum-capacity')?.context as
    { floorPages?: number } | undefined
  const capacity = Math.max(2, floor?.floorPages ?? 0)
  for (const {
    frame,
    cpuSelectMs,
    gpuSelectionFallback,
    drawn,
    residentPages,
    clusters,
  } of frames) {
    assert.equal(cpuSelectMs, null, `frame ${frame}: the CPU cut chose, GPU selection was dropped`)
    assert.equal(gpuSelectionFallback, false, `frame ${frame}: the engine declares a fallback`)
    assert.equal(hole(drawn), -1, `frame ${frame}: a leaf is not covered once by ${drawn}`)
    // Residency must be the bottleneck, or no ancestor stands in for a missing page.
    assert.ok(
      (residentPages ?? 0) <= capacity && (residentPages ?? 0) < strip.pages.length,
      `frame ${frame}: ${residentPages} resident pages for a floor of ${capacity}`,
    )
    assert.ok((clusters ?? 0) > 0, `frame ${frame}: empty cut`)
  }
  // A fallback is not only absent from the counters: it would have been announced.
  assert.ok(!events.some((e) => e.phase === 'gpu-selection-fallback'), JSON.stringify(events))
})
