// The path tracer's hit record, packed and read back from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PT_HIT_KIND, PT_HIT_WGSL, PT_HIT_WORDS } from './hitRecordWgsl.ts'

type V = number[]
interface Hit {
  kind: number
  position: V
  distance: number
  geoNormal: V
  normal: V
  uv: V
  edge1: V
  edge2: V
  colour: V
  uvEdge1: V
  uvEdge2: V
  bary: V
  material: number
  flags: number
  classKey: number
  front: boolean
  attributed: boolean
}

const snorm = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 32767) & 0xffff
const unsnorm = (h: number) => Math.max(((h << 16) >> 16) / 32767, -1)
const run = () =>
  shaderRun<{
    ptPackHit: (h: Hit) => number[][]
    ptUnpackHit: (a: number[][]) => Hit
  }>(PT_HIT_WGSL, ['ptPackHit', 'ptUnpackHit'], {
    pack2x16snorm: ([a, b]: V) => (snorm(a!) | (snorm(b!) << 16)) >>> 0,
    unpack2x16snorm: (w: number) => [unsnorm(w & 0xffff), unsnorm(w >>> 16)],
    pack2x16unorm: ([a, b]: V) => (Math.round(a! * 65535) | (Math.round(b! * 65535) << 16)) >>> 0,
    unpack2x16unorm: (w: number) => [(w & 0xffff) / 65535, (w >>> 16) / 65535],
    pack4x8unorm: (v: V) => v.reduce((w, x, k) => (w | (Math.round(x * 255) << (8 * k))) >>> 0, 0),
    unpack4x8unorm: (w: number) => [0, 8, 16, 24].map((s) => ((w >>> s) & 255) / 255),
  })

const surface: Hit = {
  kind: PT_HIT_KIND.surface,
  position: [1, 2, 3],
  distance: 4.5,
  geoNormal: [0, 0, 1],
  normal: [0, 0, 1],
  uv: [0.25, 0.75],
  edge1: [1, 0, 0],
  edge2: [0, 1, 0],
  colour: [1, 0.5, 0, 1],
  uvEdge1: [0.5, 0],
  uvEdge2: [0, 0.5],
  bary: [0.25, 0.5],
  material: 7,
  flags: 0x1234,
  classKey: 0x2a5,
  front: true,
  attributed: true,
}

test('a hit survives its record', () => {
  const hit = surface
  const words = run().ptPackHit(hit)
  assert.equal(words.length * 4, PT_HIT_WORDS)
  const back = run().ptUnpackHit(words)
  assert.deepEqual(
    [back.kind, back.material, back.flags, back.classKey, back.front, back.attributed],
    [PT_HIT_KIND.surface, 7, 0x1234, 0x2a5, true, true],
  )
  assert.deepEqual(
    [back.position, back.distance, back.uv, back.bary],
    [hit.position, hit.distance, hit.uv, hit.bary],
  )
  assert.deepEqual(
    [back.edge1, back.edge2, back.uvEdge1, back.uvEdge2],
    [hit.edge1, hit.edge2, hit.uvEdge1, hit.uvEdge2],
  )
  assert.ok(Math.abs(back.colour[1]! - 0.5) < 0.005)
})

test('an escaped ray and one that traced nothing keep their kind apart from the surface bits', () => {
  for (const kind of [PT_HIT_KIND.escaped, PT_HIT_KIND.ended]) {
    const back = run().ptUnpackHit(
      run().ptPackHit({ ...surface, kind, front: false, attributed: false, classKey: 5 }),
    )
    assert.deepEqual(
      [back.kind, back.front, back.attributed, back.classKey],
      [kind, false, false, 5],
    )
  }
})
