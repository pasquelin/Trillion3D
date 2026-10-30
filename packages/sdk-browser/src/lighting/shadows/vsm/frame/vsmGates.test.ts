// The two gates of the shadowed local lights: how they are projected (`shadowOnePassProjection`) and whether the grid's one pass lights them
// (`clusteredDeferredShading`, off by default): the lights are lit alone where either is false.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shadowsBatched, shadowsOnePass } from './vsmGates.ts'

const gates = (context: Record<string, boolean>) => {
  const rt = { context } as unknown as Parameters<typeof shadowsOnePass>[0]
  return { onePass: shadowsOnePass(rt), batched: shadowsBatched(rt) }
}

test('by default the shadowed local lights are projected in one pass and lit one by one, reading the packed mask', () => {
  assert.deepEqual(gates({}), { onePass: true, batched: false })
})

test('the clustered deferred shading puts them in the grid’s pass', () => {
  assert.deepEqual(gates({ clusteredDeferredShading: true }), { onePass: true, batched: true })
})

test('the per-light projection keeps them out of the grid’s pass whatever the clustered deferred shading says', () => {
  assert.deepEqual(gates({ shadowOnePassProjection: false, clusteredDeferredShading: true }), {
    onePass: false,
    batched: false,
  })
})
