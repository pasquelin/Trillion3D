// Every shadowed light of a frame is projected in one pass: each pixel's depth, normal,
// flags and receiver are read once for all of them, where a pass per four lights read them again.
// A light's result depends on its own trace and the pixel's inputs only, and the tile's votes stay
// in uniform flow: the per-light work is the one four-light passes did.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionText } from '../bounce/wgslBody.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import {
  VSM_PROJECTION_MAX_PASS_LIGHTS,
  VSM_PROJECTION_VIEW_BYTES,
  vsmProjectionWgsl,
} from './projectionWgsl.ts'
import { encodeVirtualShadowProjection, type VsmProjectionLight } from './projectionPass.ts'
import { camera, sun } from './projectionScene.fixture.ts'
import { vsmLayout } from './layout.ts'

const CODE = vsmProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27), {
  subgroups: false,
})

test('one store a layer the tile holds a light of, under bounds the view gives: the votes stay in uniform flow', () => {
  const entry = functionText(CODE, 'vsmProjection'),
    tile = functionText(CODE, 'vsmProjectTile')
  // The mask's one store, a layer at a time; the tile word's one, by the group's first lane.
  assert.equal(tile.match(/textureStore\(/g)?.length, 1)
  assert.match(
    tile,
    /if\(pixel\.inRect\)\{textureStore\(vsmShadowMask,pixel\.pos,layer,vec4u\(word,0u,0u,0u\)\);\}/,
  )
  assert.equal(entry.match(/textureStore\(/g)?.length, 1)
  assert.match(
    entry,
    /textureStore\(vsmShadowMaskTiles,groupId\.xy,vec4u\(vsmTileLayers\(tile\),0u,0u,0u\)\);/,
  )
  assert.match(entry, /let lightCount=select\(vsmView\.lightCount,1u,VSM_PROJECTION_ONE_LIGHT\);/)
  // The trace loops are bounded by the uniform count and skip on the uniform tile words alone.
  assert.match(tile, /for\(var layer=0u;layer<\(lightCount\+3u\)\/4u;layer\+\+\)\{/)
  assert.match(tile, /if\(held==0u\)\{continue;\}/)
  assert.match(tile, /for\(var lane=0u;lane<min\(4u,lightCount-first\);lane\+\+\)\{/)
  assert.equal(entry.match(/workgroupUniformLoad\(/g)?.length, 1)
  assert.match(entry, /vsmProjectTile\(pixel,lights,tileRead\.xy,lightCount,/)
  assert.match(CODE, /lights:array<VsmProjectionLight,64>/)
  assert.match(CODE, /texture_storage_2d_array<r32uint,write>/)
  assert.match(CODE, /texture_storage_2d<r32uint,write>/)
  assert.equal(VSM_PROJECTION_VIEW_BYTES, 416 + 64 * 48)
})

test('nine lights: one vsm.projection pass, each light at its offset of the view', async () => {
  const { device, writes } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const passes: string[] = [],
    constants: Record<string, number>[] = []
  const encoder = {
    beginComputePass: (d: GPUComputePassDescriptor) => (
      passes.push(d.label!),
      {
        // The fake device's pipeline is its descriptor's compute stage.
        setPipeline: (p: GPUProgrammableStage) =>
          constants.push(p.constants as Record<string, number>),
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() {},
      }
    ),
  } as unknown as GPUCommandEncoder
  const view = {} as GPUTextureView
  const lights: VsmProjectionLight[] = Array.from({ length: 9 }, (_, k) => ({
    type: 'point',
    mapId: 8192 + 6 * k,
    direction: [0, -1, 0],
    position: [k, 2, 3],
    radius: 10,
  }))
  encodeVirtualShadowProjection(
    encoder,
    res,
    {
      device,
      depth: view,
      normalRough: view,
      flags: view,
      mask: view,
      maskTiles: view,
      width: 64,
      height: 32,
      camera: {
        view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0],
        perspective: true,
      },
      frameIndex: 1,
      subgroups: false,
    },
    lights,
  )
  assert.deepEqual(passes, ['vsm.projection'])
  // The header and the nine records: the shader reads no record past the count.
  const upload = writes.find((w) => w.buffer.label === 'vsm.projection.view')
  assert.ok(upload)
  assert.equal(upload.size, 416 + 9 * 48, 'the view uniform, up to its last light')
  const u = new Uint32Array(upload.data.buffer, upload.data.byteOffset, upload.size! / 4)
  const f = new Float32Array(u.buffer, u.byteOffset, u.length)
  assert.equal(u[75], 9, 'the count')
  for (let k = 0; k < 9; k++) {
    const o = 104 + 12 * k
    assert.equal(u[o + 10], 8192 + 6 * k, `light ${k}'s map`)
    assert.equal(f[o] + 0, k, `light ${k}'s position, the eye at the origin`)
  }
  // Nine lights loop over the view's count; one light alone, over one the compiler knows. Each pass
  // is compiled with its lights' kinds (`projectionKinds.test.ts`): lamps 2, a sun 1, both 3.
  const inputs = {
    device,
    depth: view,
    normalRough: view,
    flags: view,
    mask: view,
    maskTiles: view,
    width: 8,
    height: 8,
  }
  const asked = [lights.slice(0, 1), [sun], [sun, lights[0]]]
  // Each is asked once, off the frame, then served by its own pipeline (`pipelineFor`).
  for (const round of [0, 1]) {
    if (round) {
      constants.length = 0
      await new Promise(setImmediate)
    }
    for (const [at, pass] of asked.entries())
      encodeVirtualShadowProjection(
        encoder,
        res,
        { ...inputs, camera, frameIndex: 2 + at + 3 * round, subgroups: false },
        pass,
      )
  }
  assert.deepEqual(
    constants.map((c) => [c.VSM_PROJECTION_ONE_LIGHT, c.VSM_PROJECTION_KINDS]),
    [
      [1, 2],
      [1, 1],
      [0, 3],
    ],
  )
  const tooMany = Array.from({ length: VSM_PROJECTION_MAX_PASS_LIGHTS + 1 }, () => lights[0])
  assert.throws(() => encodeVirtualShadowProjection(encoder, res, {} as never, tooMany))
})
