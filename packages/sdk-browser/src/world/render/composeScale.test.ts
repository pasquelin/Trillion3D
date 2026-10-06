// WebGL2 honours the render scale. A fixed scale draws the engine's image in the top-left of
// a target below the display and one Lanczos-2 resample brings it to the display, depth included;
// a still image is drawn at the bounds' maximum; the default setting draws at the display's size,
// call for call as an engine without a render scale does.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import type { HostDrawOutput, RenderBackend } from '../../backend/types.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import { autonomousRenderScale } from '../../backend/autonomous/renderScale.ts'
import { createFrameComposer } from './compose.ts'
import { createTestContext } from '../../webgl/core/testContext.fixture.ts'

const camera = G.perspectiveCamera()

/** A 64 × 32 drawing buffer on a context that renders half floats. */
function composer() {
  const context = createTestContext({
    answers: {
      getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
      drawingBufferWidth: 64,
      drawingBufferHeight: 32,
    },
  })
  return { ...context, compose: createFrameComposer(context.gl, camera) }
}

/** A WebGL2 page engine's render scale, asked `scale`, and the outputs it was drawn into. */
function engine(scale: RenderScale | undefined | false, held = false) {
  const outputs: HostDrawOutput[] = []
  const backend = {
    id: 'engine',
    scene: { background: { isColor: true, r: 0.5, g: 0, b: 1 }, children: [] },
    frameHeld: held,
    drawHostGeometry: (_camera: unknown, output: HostDrawOutput) => outputs.push({ ...output }),
    ...(scale !== false && autonomousRenderScale({ renderScale: scale })),
  } as unknown as RenderBackend
  return { backend, outputs }
}

test('a fixed scale draws the image at it and resamples it to the display', () => {
  const { compose, of, calls, gl } = composer(),
    { backend, outputs } = engine(0.5)
  // The engine's last draw, a transparent one, leaves depth writes off.
  const draw = backend.drawHostGeometry!.bind(backend)
  backend.drawHostGeometry = (camera, output) => (draw(camera, output), gl.depthMask(false))
  compose(backend, null)
  const [drawn] = outputs
  assert.deepEqual([drawn.width, drawn.height, drawn.displayWidth], [32, 16, 64])
  assert.deepEqual(compose.renderSize(), [32, 16], 'the size it was drawn at, for the metrics')
  assert.notEqual(drawn.framebuffer, null, 'drawn in a target of its own')
  assert.equal(backend.renderScale!(), 0.5)
  const program = of('shaderSource').find(([, text]) => /lanczos2/.test(text as string))
  assert.ok(program, 'the resample program')
  assert.deepEqual(of('uniform2i').at(-1)?.slice(1), [32, 16])
  assert.deepEqual(of('viewport').at(-1), [0, 0, 64, 32])
  assert.deepEqual(of('drawArrays'), [['TRIANGLES', 0, 3]], 'one full-screen resample')
  const before = calls.slice(
    0,
    calls.findIndex(({ name }) => name === 'drawArrays'),
  )
  assert.deepEqual(
    before.filter(({ name }) => name === 'depthMask').at(-1)?.args,
    [true],
    'the resample writes its depth whatever the engine left',
  )
  const after = calls.slice(calls.findIndex(({ name }) => name === 'drawArrays'))
  const unbound = after.filter(({ name }) => name === 'bindTexture').slice(0, 3)
  assert.deepEqual(
    unbound.map(({ args }) => args),
    Array(3).fill(['TEXTURE_2D', null]),
    'no draw into the target samples it',
  )
})

test('a quiet image is drawn at the bounds maximum, the one kept', () => {
  const { compose } = composer(),
    { backend, outputs } = engine({ min: 0.5, max: 0.75 }, true)
  compose(backend, null)
  assert.deepEqual([outputs[0].width, outputs[0].height], [48, 24])
  assert.equal(backend.renderScale!(), 0.75)
})

test('the default setting draws at the display, call for call as without a render scale', () => {
  const plain = composer(),
    scaled = composer()
  const a = engine(false),
    b = engine('auto')
  plain.compose(a.backend, null)
  scaled.compose(b.backend, null)
  assert.deepEqual(scaled.calls, plain.calls, 'no target, no resample')
  assert.deepEqual(b.outputs, a.outputs)
  assert.equal(b.backend.renderScale!(), 1)
  assert.deepEqual(scaled.compose.renderSize(), [64, 32], 'drawn at the display')
})
