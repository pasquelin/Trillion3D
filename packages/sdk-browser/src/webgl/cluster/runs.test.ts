// A WebGL2 frame would submit each of 1 465 pages alone, twice with a reflection capture. Pages
// placed in one arena that draw alike — one surface, one placement — are one
// submission, in the order they came; anything else breaks the run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneDraw } from './sceneDraw.ts'
import { createTestContext } from '../core/testContext.fixture.ts'
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts'
import { Scene } from '../../world/core/scene.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { GraphSurface } from '../../host/graph/surface.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'

const OUTPUT = { toneMapped: false, framebuffer: null, width: 8, height: 4 }

/** A page of `triangles` triangles over three vertices, on `surface`, at `x`. */
function page(triangles: number, surface: GraphSurface, x = 0) {
  const geometry = new Geometry().setIndex(
    new BufferAttribute(
      new Uint32Array(triangles * 3).map((_, i) => i % 3),
      1,
    ),
  )
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
  const made = new Mesh(geometry, surface)
  made.position.set(x, 0, 0)
  made.frustumCulled = false
  return made
}

function frame(scene: Scene) {
  // Each submission as `[count, byte offset]` ranges, copied when sent: the draw reuses its lists.
  const sent: number[][][] = [],
    gpu = { behind: false } // the GPU runs each frame at once, unless held behind
  const context = createTestContext({
    answers: {
      fenceSync: () => ({}),
      getSyncParameter: () => (gpu.behind ? 'UNSIGNALED' : 'SIGNALED'),
      getExtension: (name: string) =>
        name === 'EXT_color_buffer_float'
          ? {}
          : name === 'WEBGL_multi_draw' && {
              multiDrawElementsWEBGL: (
                ...[, counts, , , starts, , n]: [
                  number,
                  Int32Array,
                  number,
                  number,
                  Int32Array,
                  number,
                  number,
                ]
              ) => sent.push([...counts.subarray(0, n)].map((count, i) => [count, starts[i]])),
            },
      drawElements: (_mode: number, count: number, _type: number, offset: number) =>
        sent.push([[count, offset]]),
    },
  })
  const draw = createSceneDraw(context.gl, scene)
  const image = () => {
    sent.length = 0
    draw.render({} as HostCamera)
    draw.host.drawHostGeometry(createHostDrawCamera(), OUTPUT)
    const half = sent.length / 2
    assert.ok(Number.isInteger(half) && half > 0)
    assert.deepEqual(
      sent.slice(0, half),
      sent.slice(half),
      'source and final preserve the same runs',
    )
    return sent.slice(half)
  }
  return { draw, image, gpu }
}

test('the pages of one surface at one placement are one submission, in their order', () => {
  // Polished, under the screen-reflection cutoff: the view runs its source pass too.
  const polished = { roughness: 0.2 }
  const [stone, wood] = [
    new GraphSurface('standard', polished),
    new GraphSurface('standard', polished),
  ]
  const pages = [page(1, stone), page(2, stone), page(1, wood), page(3, stone), page(1, stone, 5)]
  const scene = new Scene()
  scene.add(...pages)
  const { draw, image } = frame(scene)
  // Placed as first drawn: the stone pages at the origin in one range, then the one at x = 5, which
  // breaks the run, then the wood.
  assert.deepEqual(image(), [[[18, 0]], [[3, 72]], [[3, 84]]])
  assert.deepEqual(draw.counters(), { triangles: 16 }, 'every triangle in source and final passes')
  pages[1].geometry.dispose()
  scene.remove(pages[1])
  const late = page(2, stone)
  scene.add(late)
  assert.deepEqual(
    image(),
    [
      [
        [3, 0],
        [9, 36],
      ],
      [[3, 72]],
      [[6, 12]],
      [[3, 84]],
    ],
    'one multi-draw of the run; the late page, behind the one at x = 5, in the range given back',
  )
  const empty = page(0, stone) // an empty page: a range of nothing, no offset to submit
  scene.add(empty)
  const ranges = image().flat()
  for (const drawn of [
    [3, 0],
    [9, 36],
    [6, 12],
  ])
    assert.ok(
      ranges.some((range) => `${range}` === `${drawn}`),
      `the page at ${drawn} still drawn`,
    )
  assert.ok(
    ranges.every(([, offset]) => offset >= 0),
    'an empty page keeps its own buffers',
  )
  scene.remove(empty)
  late.geometry.index!.needsUpdate = true
  const own = image()
  assert.equal(own.length, 4, 'a page rewritten once placed leaves the run for buffers of its own')
  draw.dispose()
})

test('released ranges are written again only once the GPU ran the frames that drew them', () => {
  const stone = new GraphSurface('standard', { roughness: 0.2 }),
    scene = new Scene()
  const swap = (gone: ReturnType<typeof page>) => {
    gone.geometry.dispose()
    scene.remove(gone)
    const next = page(2, stone)
    scene.add(next)
    return next
  }
  const first = page(2, stone)
  scene.add(first)
  const { image, gpu } = frame(scene)
  assert.deepEqual(image(), [[[6, 0]]])
  gpu.behind = true
  const second = swap(first)
  assert.deepEqual(image(), [[[6, 24]]], 'the GPU may still read the released range: a new one')
  gpu.behind = false
  swap(second)
  assert.deepEqual(image(), [[[6, 0]]], 'the GPU ran past it: the range is written again')
})
