// The world's views (`world.addView`): made in each session that opens, drawn after the main image
// in the order they were added, each at most at its own frame rate, their metrics carried by the
// world's frame and handed to their own hooks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { ViewFrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { MeasuredWorld } from '../explorer.ts'
import { createWorldViews } from './views.ts'
import { createFrameCap, resetFrameCap, skipsDisplayFrame } from '../../frame/cadence.ts'

const HZ60 = 1000 / 60

const canvas = { width: 200, height: 100, clientWidth: 100, clientHeight: 50 } as HTMLCanvasElement

/** A session whose engine makes views that record what they draw. */
function session() {
  const made: { rect?: unknown; drawn: number; scale?: unknown; released: boolean }[] = []
  const engine = {
    async addView(options: { rect?: unknown }) {
      const record = { rect: options.rect, drawn: 0, scale: undefined as unknown, released: false }
      made.push(record)
      const metrics = {} as ViewFrameMetrics
      return {
        render: (_camera: unknown, index: number) => (
          record.drawn++,
          (metrics.index = index),
          metrics
        ),
        resize: (_w: number, _h: number, rect?: unknown) => void (record.rect = rect),
        setRenderScale: (scale: unknown) => void (record.scale = scale),
        setTemporalAntialiasing: () => {},
        release: async () => void (record.released = true),
      }
    },
  }
  return { made, world: { engine, camera: new Camera('perspective') } as unknown as MeasuredWorld }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

test('a view draws into a canvas or over a viewport, one of them', () => {
  const views = createWorldViews({ canvas, pixelRatio: 1, invalidate: () => {} })
  assert.throws(() => views.addView({}), { code: 'INVALID_VIEW' })
})

test('views are made in the open session, drawn after the main image, their metrics carried', async () => {
  let asked = 0
  const views = createWorldViews({ canvas, pixelRatio: 1, invalidate: () => asked++ })
  const left = views.addView({ viewport: { x: 0, y: 0, width: 50, height: 50 } })
  const right = views.addView({
    viewport: { x: 50, y: 0, width: 50, height: 50 },
    renderScale: 0.5,
  })
  const { made, world } = session()
  views.attach(world)
  await settle()
  assert.equal(made.length, 2)
  assert.deepEqual(made[1].rect, { x: 100, y: 0, width: 100, height: 100 }, 'canvas pixels')
  assert.ok(asked > 0, 'a frame asked once made')
  const seen: number[] = []
  right.onFrame(({ metrics }) => seen.push(metrics.index))
  views.draw(null)
  const frame: { views?: readonly ViewFrameMetrics[] } = {}
  views.drawnIn(frame)
  views.dispatch()
  assert.deepEqual(
    frame.views?.map((m) => m.index),
    [0, 1],
    'in the order they were added',
  )
  assert.deepEqual(seen, [1], 'each view’s own hook')
  right.renderScale = 1
  assert.equal(made[1].scale, 1)
  left.dispose()
  assert.equal(made[0].released, true)
  assert.equal(views.list.length, 1)
  views.dispose()
  assert.equal(made[1].released, true)
})

test('a view capped below the world’s rate is left out of the frames it is not due in', async () => {
  const views = createWorldViews({ canvas, pixelRatio: 1, invalidate: () => {} })
  views.addView({ viewport: { x: 0, y: 0, width: 10, height: 10 }, maxFrameRate: 1 })
  const { made, world } = session()
  views.attach(world)
  await settle()
  views.draw(HZ60)
  views.draw(HZ60)
  assert.equal(made[0].drawn, 1, 'one image a second at most')
  views.attach(null)
  views.draw(HZ60)
  assert.equal(made[0].drawn, 1, 'no session, no image')
})

test('a view is capped by the rule of the main view’s cap: whole refreshes, 50 a second on 60 Hz is 30', async () => {
  const views = createWorldViews({ canvas, pixelRatio: 1, invalidate: () => {} })
  views.addView({ viewport: { x: 0, y: 0, width: 10, height: 10 }, maxFrameRate: 50 })
  const { made, world } = session()
  views.attach(world)
  await settle()
  const cap = createFrameCap(50)
  resetFrameCap(cap, HZ60)
  const refresh = { display: HZ60, settled: true }
  let main = 0
  const timeline = { currentTime: 0 }
  Object.assign(globalThis, { document: { timeline } })
  try {
    for (let frame = 0; frame < 60; frame++) {
      const now = (timeline.currentTime = 1000 + frame * HZ60)
      views.draw(HZ60)
      if (!skipsDisplayFrame(cap, refresh, now)) {
        main++
        cap.drawnAt = now
      }
    }
  } finally {
    delete (globalThis as { document?: unknown }).document
  }
  assert.equal(main, 30, 'the main view draws every second refresh')
  assert.equal(made[0].drawn, main, 'the view draws on the same refreshes')
})
