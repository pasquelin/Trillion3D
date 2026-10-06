import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import {
  evaluated,
  lastUniform,
  lightFrames,
  pointLamp,
  sent,
  triangle,
} from './lightGrid.fixture.ts'

// #835: the WebGL2 light grid is listed again only when a lamp's reach changes, and no draw of a
// frame — its reflection capture's included — does any light work of its own.

/** 40 lamps in a row, a mirror between two triangles, drawn by one renderer. */
function mirrorFrame() {
  const lights = Array.from({ length: 40 }, (_, i) => pointLamp([i * 0.5 - 10, 1, 0], 2))
  return { lights, ...lightFrames(lights, [triangle(0, true), triangle(-6), triangle(6)]) }
}

test('a frame that moves only the camera lists no lamp and sends no list row', () => {
  const { context, renderer, lights, frame } = mirrorFrame()
  // The grid is sent each time it is listed, and only then.
  frame(0)
  assert.equal(sent(context, 'RED_INTEGER').length, 1, 'the first frame lists and sends the grid')
  const toGrid = () =>
    (lastUniform(context, 'uniformMatrix4fv', 'viewToGrid') as [boolean, Float32Array])[1]
  const [scale, offset] = [toGrid()[0], toGrid()[12]]
  const before = context.of('texSubImage2D').length
  frame(3)
  assert.deepEqual(sent(context, 'RED_INTEGER', before), [], 'a moved camera sends no list row')
  assert.equal(sent(context, 'RGBA', before).length, 1, 'the view-space records are sent')
  const shift = toGrid()[12] - offset
  assert.ok(Math.abs(shift - 3 * scale) < 1e-4, 'the grid follows the view by its matrix alone')

  lights[0].distance = 3
  const moved = context.of('texSubImage2D').length
  frame(3)
  assert.equal(sent(context, 'RED_INTEGER', moved).length, 1, 'a new range lists it again')
  renderer.dispose()
})

test('a reflection capture and the frame after it do no per-draw light work', () => {
  const { context, renderer, frame } = mirrorFrame()
  frame(0)
  assert.equal(renderer.backdropPasses, 1, 'the mirror captures the scene')
  assert.equal(
    context.of('drawElements').length,
    7,
    'three draws in the capture, the mirror in the reduced resolve, three after',
  )
  const lightUniforms = ['uniform1i', 'uniform2i', 'uniform3i', 'uniformMatrix4fv']
    .flatMap((call) => context.of(call))
    .filter((args) => {
      const name = (args[0] as { uniform: string } | null)?.uniform
      return (
        name === 'lightSpan' ||
        name === 'lightGrid' ||
        name === 'gridCells' ||
        name === 'viewToGrid'
      )
    })
  assert.equal(lightUniforms.length, 3, 'one grid for the frame: no light uniform per draw')
  assert.equal(sent(context, 'RED_INTEGER').length, 1, 'the lists sent once, before any draw')
  renderer.dispose()
})

test('the grid scales with its lamps, not with the space between them, and skips a lamp placed nowhere', () => {
  // Two small lamps a kilometre apart, one on each axis, and one whose centre is not a number.
  const lights = [
    pointLamp([0, 0, 0], 0.1),
    pointLamp([1000, 1000, 1000], 0.1),
    pointLamp([NaN, 0, 0], 0.1),
  ]
  const { context, renderer, frame } = lightFrames(lights, [triangle(0)])
  frame()
  const cells = lastUniform(context, 'uniform3i', 'gridCells') as number[]
  assert.ok(cells[0] * cells[1] * cells[2] <= 2 * 512, `${cells.join('×')} cells for two lamps`)
  assert.ok(Math.max(...cells) <= 4096, 'an axis stays where single precision finds the cell')
  assert.deepEqual(evaluated(context, [0, 0, 0]).slots, [0], 'the near lamp reaches its cell')
  assert.deepEqual(evaluated(context, [1000, 1000, 1000]).slots, [1], 'the far one its own')
  assert.deepEqual(evaluated(context, [0, 500, 0]).slots, [], 'the lamp with no centre, nowhere')
  renderer.dispose()
})

test('a moving sun lists nothing again, and far-reaching lamps among small ones stay bounded', () => {
  const sun = new G.Light('directional', { position: [0, 1, 0] })
  // 500 small lamps, 500 that reach the whole grid.
  const lights = [
    ...Array.from({ length: 1000 }, (_, i) =>
      pointLamp(
        [(i % 10) * 3, Math.floor(i / 10) % 10, Math.floor(i / 100) * 3],
        i % 2 ? 100 : 0.1,
      ),
    ),
    sun as unknown as Light,
  ]
  sun.updateMatrixWorld(true)
  const { context, renderer, frame } = lightFrames(lights, [triangle(0)])
  frame()
  const listed = sent(context, 'RED_INTEGER')
  assert.equal(listed.length, 1)
  const cells = lastUniform(context, 'uniform3i', 'gridCells') as number[]
  const texels = (listed[0][8] as Int32Array).length
  assert.ok(texels <= 2048 * 1024, `${texels} texels within the rows every device holds`)
  assert.ok(cells[0] * cells[1] * cells[2] > 1, 'the small lamps still split the grid')
  assert.ok(evaluated(context, [0, 0, 0]).slots.includes(0), 'a small lamp reaches its cell')
  sun.position.set(5, 3, 1)
  sun.updateMatrixWorld(true)
  const before = context.of('texSubImage2D').length
  frame()
  assert.deepEqual(sent(context, 'RED_INTEGER', before), [], 'a moved sun sends no list row')
  renderer.dispose()
})
