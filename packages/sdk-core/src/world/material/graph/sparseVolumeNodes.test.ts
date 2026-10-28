// The sparse volume texture nodes of the material graph: their specs and their refusals.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../index.ts'
import { NODE_SPECS } from './nodeSpecs.ts'
import { validateGraph } from './validate.ts'

test('the nodes start with the reference defaults', () => {
  assert.deepEqual(NODE_SPECS.sparseVolumeTextureSample.props, {
    source: -1,
    name: '',
    mipMode: 'none',
    constMip: 0,
    address: 'clamp',
    attributes: 0,
  })
  assert.deepEqual(NODE_SPECS.sparseVolumeTextureSample.inputs, [
    'uvw',
    'texture',
    'mip',
    'ddx',
    'ddy',
  ])
  assert.deepEqual(NODE_SPECS.sparseVolumeTextureObject.props, { source: -1 })
})

test('a sample needs a volume, its derivatives in their mode, and known modes', () => {
  const graph = (build: (g: ReturnType<typeof material.graph>) => void) => {
    const g = material.graph('volume')
    build(g)
    return g
  }
  assert.throws(
    () => validateGraph(graph((g) => g.sparseVolumeTextureSample(undefined))),
    /Missing input texture/,
  )
  assert.throws(
    () => validateGraph(graph((g) => g.sparseVolumeTextureObject(-1))),
    /requires a sparse volume texture/,
  )
  assert.throws(
    () => validateGraph(graph((g) => g.sparseVolumeTextureSample(0, { mipMode: 'derivative' }))),
    /Missing DDX\(UVs\) parameter/,
  )
  assert.throws(
    () =>
      validateGraph(
        graph((g) => g.sparseVolumeTextureSample(0, { mipMode: 'derivative', ddx: g.constant(0) })),
      ),
    /Missing DDY\(UVs\) parameter/,
  )
  assert.throws(
    () => validateGraph(graph((g) => g.sparseVolumeTextureSample(0, { address: 'bad' as never }))),
    /no address mode/,
  )
  assert.throws(
    () => validateGraph(graph((g) => g.sparseVolumeTextureParameter('', 0))),
    /needs a name/,
  )
  validateGraph(graph((g) => g.sparseVolumeTextureSample(3, { mipMode: 'level', mip: 1 })))
})
