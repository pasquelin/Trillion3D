// The page marking and the shadow projection rebuild a pixel's position from the same depth, drawn
// with the TAA jitter in it (`vsmEncode.ts`, #1363): the view-to-clip the marking uploads is the
// projection's, jitter included, and both read the camera's kind, never a matrix test. Proved on
// the sweep's cameras, accumulation on and off, against the view header the projection uploads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice, replayWrites } from '../../../../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmMarking, vsmForwardZViewToClip } from '../../../../vsm/markingPass.ts'
import { createVsmResources } from '../../../../vsm/resources.ts'
import { cam, camera, now, sweptHeaders } from './vsmProject.fixture.ts'

const { device, writes } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
const handle = {} as GPUTextureView
const buffer = device.createBuffer({
  size: 256,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM,
})
const pass = new Proxy({}, { get: () => () => {} }) as unknown as GPUComputePassEncoder
const bin = { offset: 0, count: 0 }

/** The marking's parameter words for a frame viewed through `projection`. */
function markingWords(projection: ArrayLike<number>, perspective: boolean, size: number[]) {
  writes.length = 0
  // A marking made now holds zeroed parameters: every word it sends is seen.
  const marking = createVsmMarking(device, res)
  marking.encode(pass, {
    fullMapCount: 1,
    singlePageMapCount: 0,
    perspective,
    perPage: {
      ids: new Uint32Array(2),
      all: [bin, bin, bin, bin],
      directionalOnly: [bin, bin, bin, bin],
    },
    view: {
      depth: handle,
      normalRough: handle,
      flags: handle,
      view: buffer,
      directLights: buffer,
      tileLights: buffer,
      lightVsmIds: buffer,
      sunMapIds: buffer,
      sunMapCount: 0,
      viewRectMin: [0, 0],
      viewSize: [size[0], size[1]],
      viewToClip: vsmForwardZViewToClip(projection),
      originShift: [0, 0, 0],
    },
  })
  const params = new ArrayBuffer(1024)
  replayWrites(
    params,
    writes.filter((w) => (w.buffer as { label?: string }).label === 'vsm.marking.params'),
  )
  marking.destroy()
  return new Float32Array(params, 0, 24)
}

test('the marking reads the projection the raster drew with: its view-to-clip is the projection header’s, its depth words the same to f32 rounding', () => {
  for (const { i, active, width, height, fresh, at } of sweptHeaders()) {
    const words = markingWords(now, cam.perspective === 1, [width, height])
    for (let k = 0; k < 16; k++) assert.equal(words[k], fresh[32 + k], `${at} view-to-clip ${k}`)
    // The depth words: the marking's from the f32 matrix it holds, the projection's from the f64 one.
    for (let k = 0; k < 4; k++)
      assert.ok(
        Math.abs(words[16 + k] - fresh[80 + k]) <= 1e-5 * Math.max(1, Math.abs(fresh[80 + k])),
        `${at} depth ${k}`,
      )
    if (active) {
      camera(i)
      const plain = markingWords(cam.projection, cam.perspective === 1, [width, height])
      assert.notDeepEqual(plain.slice(0, 16), words.slice(0, 16), `${at} unjittered differs`)
    }
  }
})
