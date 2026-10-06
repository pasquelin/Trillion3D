// #834: an image WebGL2 draws below the display reads its materials a level coarser per halving,
// `log2 s` (`upscaleMipBias`), through GLSL `texture(…, bias)`, so a texture keeps the texel density
// it has at the display's size; a line keeps its display width. At the display's size, zero.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT } from './shaders.ts'
import { createSceneDraw } from './sceneDraw.ts'
import { createTestContext } from '../core/testContext.fixture.ts'
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts'
import { Scene } from '../../world/core/scene.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { GraphSurface } from '../../host/graph/surface.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { HostDrawOutput } from '../core/renderTarget.ts'

test('every material map is read with the frame mip bias, in both programs', () => {
  for (const text of [CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT]) {
    const reads = text.match(/texture\(\w+Map,/g) ?? []
    const biased = text.match(
      /texture\(\w+Map,mapUv\(\w+,(?:sourceUv\(\w+(?:\.\w)?\)|st)\),mipBias\)/g,
    )
    assert.equal(reads.length, 7)
    assert.match(text, /atlasLod[\s\S]*?\+mipBias/)
    assert.equal(biased?.length, reads.length, 'each read carries mipBias')
  }
})

/** The `mipBias` and `pixelRatio` the frame's draw wrote for `output`, the host ratio being 2. */
function written(output: HostDrawOutput) {
  const { last } = drawn([output])
  return { mipBias: last('mipBias'), pixelRatio: last('pixelRatio') }
}

/** A one-mesh scene drawn once per output of `outputs`, and the float uniforms its frames wrote. */
function drawn(outputs: HostDrawOutput[], model: 'lambert' | 'standard' = 'lambert') {
  const context = createTestContext({
    answers: { getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null) },
  })
  const scene = new Scene(),
    geometry = new Geometry().setIndex(new BufferAttribute(new Uint32Array(3), 1))
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
  // A polished physical surface, under the screen-reflection cutoff: it runs a source pass (#1341).
  const mesh = new Mesh(geometry, new GraphSurface(model, { roughness: 0.2 }))
  mesh.frustumCulled = false
  scene.add(mesh)
  const draw = createSceneDraw(context.gl, scene, [], { pixelRatio: () => 2 })
  for (const output of outputs) {
    draw.render({} as HostCamera)
    draw.host.drawHostGeometry(createHostDrawCamera(), output)
  }
  const named = (call: string, name: string) =>
    context.of(call).filter(([at]) => (at as { uniform: string }).uniform === name)
  draw.dispose()
  return {
    named,
    submissions: context.of('drawElements').length,
    last: (name: string) => named('uniform1f', name).at(-1)?.[1],
  }
}

test('an image drawn at half the display reads its maps log2 0.5 = -1 level, lines at its ratio', () => {
  const base = { toneMapped: false, framebuffer: null, height: 16 }
  assert.deepEqual(written({ ...base, width: 32, displayWidth: 64 }), {
    mipBias: -1,
    pixelRatio: 1,
  })
  assert.deepEqual(written({ ...base, width: 48, displayWidth: 64 }).mipBias, Math.log2(0.75))
  assert.deepEqual(written({ ...base, width: 64 }), { mipBias: 0, pixelRatio: 2 })
})

// The bias has a cache slot of its own: a frame's bias never stands for a material's `covering`
// (the next material would skip its own write), nor is either written again on an unchanged frame.
test('an unchanged frame writes neither the mip bias nor a material uniform again', () => {
  const output = { toneMapped: false, framebuffer: null, width: 64, height: 16 }
  const { named } = drawn([output, output])
  assert.equal(named('uniform1f', 'mipBias').length, 1)
  assert.equal(named('uniform1i', 'covering').length, 1)
})

test('unchanged physical frames retain material uniform caches through source and final passes', () => {
  const output = { toneMapped: false, framebuffer: null, width: 64, height: 16 }
  const { named, submissions } = drawn([output, output], 'standard')
  assert.equal(submissions, 4, 'both frames execute source and final geometry')
  for (const name of ['mipBias', 'roughFactor', 'metalFactor'])
    assert.equal(
      named('uniform1f', name).length,
      1,
      `${name} stays cached across passes and frames`,
    )
  assert.equal(named('uniform1i', 'covering').length, 1)
  assert.equal(named('uniform4f', 'baseFactor').length, 1)
  assert.equal(named('uniform4f', 'physical').length, 1)
})
