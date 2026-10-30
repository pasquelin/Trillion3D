// The screen probes of a view whose pixels hold several closures: the pixel data of the closures past the first (a layer each of the history, textures of their own for
// the rest), the pixel passes dispatched for each of them over the same kernels, and the bit that tells the lighting they were gathered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { gpuAllocator } from '../../gpu/core/resourceAllocator.ts'
import { createScreenProbeResources, screenProbeBytes } from './screen/resources.ts'
import { SCREEN_CLOSURES_GATHERED, screenProbeGeometry } from './screen/screenProbeLayout.ts'
import { ensureScreenProbeView } from './screen/view.ts'

const settings = screenProbeSettings({ screenProbes: 'ultra', screenProbeShortRangeGI: true })
const geometry = screenProbeGeometry(256, 128, settings)

test('a view of one closure holds the single-closure resources; of several, the history and the short-range illumination are arrays and each closure past the first has pixel textures', () => {
  const plain = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  const one = createScreenProbeResources(gpuAllocator(plain.device, 'one'), geometry, settings)
  assert.equal(one.closures, undefined)
  assert.equal(
    screenProbeBytes(geometry, settings, 1),
    screenProbeBytes(geometry, settings),
    'a count of one is the single-closure size',
  )
  const many = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  const three = createScreenProbeResources(
    gpuAllocator(many.device, 'three'),
    geometry,
    settings,
    3,
  )
  assert.equal(three.closures?.held, 3)
  assert.equal(three.closures?.sets.length, 2)
  const layersOf = (label: string) =>
    many.textures.filter((t) => t.label === `three ${label}`).map((t) => t.depthOrArrayLayers)
  // The words of the history and the illumination are one array texture a turn, a layer for each closure; the first closure's views are its layer.
  assert.deepEqual(layersOf('history 0'), [3])
  assert.deepEqual(layersOf('history 1'), [3])
  assert.deepEqual(layersOf('short-range global illumination history 0'), [3])
  // The rest are textures of the closure's own, of the single-closure kind.
  assert.deepEqual(layersOf('occlusion closure 1'), [1])
  assert.deepEqual(layersOf('occlusion closure 2'), [1])
  assert.deepEqual(layersOf('history shading 0 closure 2'), [1])
  assert.deepEqual(layersOf('integrated light closure 1'), [1])
  // The probes are the first closure's alone.
  assert.deepEqual(layersOf('probes 0'), [1])
  assert.ok(screenProbeBytes(geometry, settings, 3) > screenProbeBytes(geometry, settings, 1))
  // The counting allocator makes the same: the bytes it counts are the ones made.
  const counted = gpuAllocator(fakeDevice({ limits: { maxTextureDimension2D: 8192 } }).device, 'c')
  createScreenProbeResources(counted, geometry, settings, 3)
  assert.equal(counted.bytes(), screenProbeBytes(geometry, settings, 3))
})

test('a view is made again when the closures a pixel holds change, and kept while they do not', () => {
  const { device } = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  const first = ensureScreenProbeView(undefined, device, [256, 128], settings, 2).view!
  assert.equal(first.closures, 2)
  assert.equal(ensureScreenProbeView(first, device, [256, 128], settings, 2).view, first)
  const other = ensureScreenProbeView(first, device, [256, 128], settings, 3).view!
  assert.notEqual(other, first)
  assert.equal(other.closures, 3)
  assert.equal(other.resources.closures?.sets.length, 2)
  assert.equal(ensureScreenProbeView(undefined, device, [256, 128], settings).view!.closures, 1)
})

test('the bit that says the probes gathered every closure is clear of the others of the lighting’s mode word', () => {
  // Bit 0 occlusion alone, bit 1 no back light, bit 2 the occlusion applied in the integration.
  assert.equal(SCREEN_CLOSURES_GATHERED & (1 | 2 | 4), 0)
  assert.equal(SCREEN_CLOSURES_GATHERED, 8)
})
