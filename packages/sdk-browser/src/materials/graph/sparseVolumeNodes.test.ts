// The sparse volume texture nodes: what a volume graph that reads one compiles to.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { COLOR_SAMPLE_WGSL } from '../virtual/wgsl.ts'
import { compileGraph } from './compile.ts'
import type { Graph } from './graphBody.fixture.ts'

const compiled = (build: (g: Graph) => void) => {
  const g = material.graph('volume')
  build(g)
  return { g, c: compileGraph(g, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' }) }
}

test('a sample with a computed level reads the two levels around it and blends them', () => {
  const { c } = compiled((g) => {
    g.output('emissive', g.sparseVolumeTextureSample(4))
  })
  const text = c.outputs[0].body
  assert.match(text, /svtVolumeUvw\(ctx\)/)
  assert.match(text, /svtCalculateMip\(g\.t\[0\]\.x,.*,0\.0\)/)
  assert.match(text, /svtSample\(g\.t\[0\]\.x,[^,]*,vec3u\(0u\),i32\(floor\(/)
  assert.match(text, /i32\(ceil\(/)
  assert.match(text, /mix\(.*fract\(/)
  assert.equal(c.uses.sparseVolumes, true)
  assert.equal(c.uses.textures, false)
  assert.deepEqual(
    c.slots.textures.map((slot) => slot.source),
    [4],
  )
})

test('an absolute level skips the footprint and the mode derivative reads the wired derivatives', () => {
  const level = compiled((g) => {
    g.output(
      'emissive',
      g.sparseVolumeTextureSample(1, { mipMode: 'level', mip: 2, address: 'wrap' }),
    )
  }).c.outputs[0].body
  assert.doesNotMatch(level, /svtCalculateMip/)
  assert.match(level, /vec3u\(1u\)/)
  const derivative = compiled((g) => {
    const uvw = g.worldPosition()
    g.output(
      'emissive',
      g.sparseVolumeTextureSample(1, {
        mipMode: 'derivative',
        uvw,
        ddx: uvw,
        ddy: uvw,
        attributes: 1,
      }),
    )
  }).c.outputs[0].body
  assert.match(derivative, /svtCalculateMip\(g\.t\[0\]\.x,.*,0\.0\)/)
  assert.match(derivative, /,1u\)/)
})

test('a volume object wired to a sample, or a parameter, is one word of the values', () => {
  const { g, c } = compiled((g) => {
    const object = g.sparseVolumeTextureParameter('smoke', 7)
    g.output('emissive', g.sparseVolumeTextureSample(undefined, { texture: object }))
  })
  assert.match(c.outputs[0].body, /svtSample\(g\.t\[0\]\.x,/)
  const words = new Uint32Array(64)
  assert.equal(
    c.slots.fill(g, words.buffer, 0, () => 0),
    true,
  )
  assert.equal(words[Math.max(c.slots.vectors.length, 1) * 4], 7)
  // A number written to the parameter names another volume.
  g.set('smoke', 9)
  const again = new Uint32Array(64)
  c.slots.fill(g, again.buffer, 0, () => 0)
  assert.equal(again[Math.max(c.slots.vectors.length, 1) * 4], 9)
})

test('a sparse volume cannot be wired where a number is read, nor a texture where a volume is', () => {
  assert.throws(() => {
    const g = material.graph('volume')
    g.output('emissive', g.sparseVolumeTextureObject(1))
    compileGraph(g, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' })
  }, /texture cannot be wired|sparse volume texture/)
})
