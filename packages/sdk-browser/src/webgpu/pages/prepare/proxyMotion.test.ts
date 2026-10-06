import test from 'node:test'
import assert from 'node:assert/strict'
import { syncLightingProxies, syncPageProxy } from './proxyMotion.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

test('borrowed proxies follow off-move-on and late loads without duplicate epoch work', () => {
  let observed = -1,
    updates = 0,
    refreshes = 0
  const matrix = new Float64Array(16)
  matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1
  const moving = {
    sync(worldOf: (rank: number) => ArrayLike<number> | undefined) {
      updates++
      observed = worldOf(-1)![12]
      return 'moved' as const
    },
  }
  const rt = {
    setup: {
      source: { traverse() {}, _alive: true },
      worlds: { of: () => ({ elements: matrix }), refresh: () => refreshes++ },
    },
    run: { gate: { revisions: { scene: 1 } } },
    bounce: { wanted: false, probes: moving },
  } as unknown as WebgpuPagesRuntime
  syncLightingProxies(rt)
  matrix[12] = 40
  rt.run.gate.revisions.scene++
  syncLightingProxies(rt)
  assert.equal(observed, 40, 'off bounce still updates the kept proxy')
  rt.bounce.wanted = true
  syncLightingProxies(rt)
  assert.equal(updates, 2, 'toggle alone does not repeat geometry work')
  const late = { sync: moving.sync }
  matrix[12] = 90
  syncPageProxy(rt, late, true)
  assert.equal(refreshes, 1)
  assert.equal(observed, 90, 'late arrival sees current host world, not its cooked pose')
})

test('a settling proxy syncs once per still frame until it settles, then once per scene write', () => {
  let syncs = 0
  const proxy = {
    settling: true,
    sync: () => (syncs++, 'moved' as const),
  }
  const rt = {
    setup: { source: { traverse() {} }, worlds: { of: () => undefined } },
    run: { frame: 1, gate: { revisions: { scene: 1 } } },
  } as unknown as WebgpuPagesRuntime
  syncPageProxy(rt, proxy)
  syncPageProxy(rt, proxy)
  assert.equal(syncs, 1, 'a second sync in the frame that moved does not count a still frame')
  rt.run.frame++
  syncPageProxy(rt, proxy)
  rt.run.frame++
  syncPageProxy(rt, proxy)
  assert.equal(syncs, 3, 'each still frame reaches the proxy while it waits to settle')
  proxy.settling = false
  rt.run.frame++
  syncPageProxy(rt, proxy)
  assert.equal(syncs, 3, 'settled, or unable to: a still frame costs nothing')
  rt.run.gate.revisions.scene++
  syncPageProxy(rt, proxy)
  rt.run.frame++
  syncPageProxy(rt, proxy)
  assert.equal(syncs, 4, 'a still proxy syncs once per scene write')
})
