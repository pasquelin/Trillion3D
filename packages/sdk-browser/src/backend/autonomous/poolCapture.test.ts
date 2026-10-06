// The WebGL2 union under budget pressure: a capture keeps the detail pages it keeps alone,
// its requests ranked before the union's (`poolUnion.ts`), as WebGPU's queue does; the main
// and persistent views rank the union coarsest first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE } from './pool.fixture.ts'
import { mount } from './poolCut.fixture.ts'
import { createUnionFit, type Ranked } from './poolUnion.ts'
import { createWebglViews } from './views.ts'
import { createEngineCamera } from '../../camera/world.ts'
import { dag, dagCamera } from '../../../../../bench/perf/browser/support/dagCut.ts'
import type { HostCamera } from '../../camera/world.ts'
import type { PageRec } from '../../page/selection/selection.ts'

const urls = (list: readonly PageRec[]) => list.map((page) => page.url)
/** A camera `height` units above `(x, y)` of the DAG's plane, looking straight down at it. */
const above = (x: number, y: number, height: number) =>
  dagCamera(height, x, y) as unknown as HostCamera
const MAIN = above(0, 0, 20), // coarser pages than the capture's, which rank first
  CAPTURE = above(2, 2, 7)
const pagesOf = () => dag({ feuilles: 256, seed: 11, residentes: 0 })

/** What a view at `camera` asks for alone under `bytes` of budget, over `images` images. */
function alone(camera: HostCamera, bytes: number, images: number) {
  const m = mount(bytes, { pages: pagesOf() })
  m.place(camera)
  const asked: string[][] = []
  for (let i = 0; i < images; i++) asked.push((m.image(1), urls(m.views.live.requested)))
  return { asked, slots: m.pool.held.slots }
}

test('under budget pressure a WebGL2 capture keeps the detail pages it kept alone', () => {
  const m = mount(1000 * PAGE, { pages: pagesOf() }),
    { views } = m
  m.place(MAIN)
  for (let i = 0; i < 6; i++) m.image(1)
  // A budget the capture's cut alone overruns, the main view's requests beside it.
  const wide = alone(CAPTURE, 1000 * PAGE, 1).asked[0].length
  const bytes = Math.floor(wide / 2) * PAGE
  m.pool.resize(bytes)
  m.image(1)
  assert.ok(m.requested.length > 0, 'the main view asks for pages of its own')
  const reference = alone(CAPTURE, bytes, 3)
  assert.ok(reference.asked[0].length < wide, 'the capture alone is under budget pressure')
  const asked: string[][] = []
  views.captureAside({ width: 1280, height: 720 }, () => {
    assert.equal(views.captureDrawn(), true, 'the drawn view is a capture')
    m.place(CAPTURE)
    for (let i = 0; i < 3; i++) asked.push((m.image(1), urls(views.live.requested)))
  })
  assert.equal(views.captureDrawn(), false, 'the capture is over')
  assert.equal(m.pool.held.slots, reference.slots, 'the one budget')
  assert.deepEqual(asked, reference.asked, 'the pages kept under pressure are the pages alone')
})

/** Pages `name0`… of levels 3 to 0, coarsest first, one slot each. */
const levels = [3, 2, 1, 0]
const list = (name: string) =>
  levels.map((level, i) => ({ url: `${name}${i}`, level }) as Ranked as PageRec)
const shares = new Map(['c', 'd', 'o'].flatMap((name) => list(name)).map((p) => [p.url, 1]))

test('the main and persistent views rank the union coarsest first, as before captures', () => {
  const views = createWebglViews([8, 8], { cam: createEngineCamera(), viewReplaced() {} }, () => {})
  views.use(views.create(4, 4))
  assert.equal(views.captureDrawn(), false, 'a persistent view drawn is no capture')
  views.use(views.main)
  assert.equal(views.captureDrawn(), false, 'nor is the main view')
  const drawn = list('d'),
    other = { requested: list('o') }
  const union = createUnionFit(shares, [other])
  // Four slots: the two coarsest levels of either view, the drawn view first on a tie.
  assert.equal(union.fit(drawn, 4, 0), 2)
  assert.deepEqual(urls(other.requested), ['o0', 'o1'])
  assert.equal(union.used, 8, 'the whole union is charged')
  // Whichever is drawn, the same union is asked for: views drawn every frame trade no slots.
  const back = { requested: drawn.slice(0, 2) }
  const turned = createUnionFit(shares, [back])
  assert.equal(turned.fit(list('o'), 4, 0), 2)
  assert.deepEqual(urls(back.requested), ['d0', 'd1'])
  // A capture, drawn first: it keeps its four, the other view what room is left, here none.
  const capture = list('c'),
    main = { requested: list('o') }
  const first = createUnionFit(shares, [main])
  assert.equal(first.fit(capture, 4, 0, true), 4)
  assert.deepEqual(main.requested, [])
  // The next fit without a capture ranks the union again.
  main.requested = list('o')
  assert.equal(first.fit(capture, 4, 0), 2)
  assert.deepEqual(urls(main.requested), ['o0', 'o1'])
})
