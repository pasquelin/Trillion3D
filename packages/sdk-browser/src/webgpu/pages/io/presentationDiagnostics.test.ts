import test from 'node:test'
import assert from 'node:assert/strict'
import { presentationColorDiagnostic } from '../../../measurement/measurement.ts'
import { webgpuPagesEngine } from '../pages.ts'
import { outputColorDiagnostic } from '../../../diagnostic/presentationDiagnostic.ts'
import { collectClusterPages } from '../../../page/selection/selection.ts'
import { packDagSelection } from '../../../gpu/dag/selection.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { quadScene, camera, quadBackend } from '../testScenes.fixture.ts'

test('the GPU readback diagnostic distinguishes the requested clear color from the rendered pixels', () => {
  const pixels = new Uint8Array([42, 48, 60, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255])
  assert.deepEqual(outputColorDiagnostic(pixels, 2, 2, 0x2a303c), {
    clearColor: '#2a303c',
    topLeft: '#2a303c',
    center: '#070809',
    matchesClearAtTopLeft: true,
  })
})

test('the presentation diagnostic reads a capture bottom row first, from the WebGPU colour target', () => {
  // A capture's first row is the image's bottom one: the top-left pixel is the third.
  const pixels = new Uint8Array([1, 2, 3, 255, 7, 8, 9, 255, 42, 48, 60, 255, 4, 5, 6, 255])
  assert.deepEqual(presentationColorDiagnostic(pixels, 2, 2, 0x2a303c), {
    clearColor: '#2a303c',
    topLeft: '#2a303c',
    center: '#070809',
    matchesClearAtTopLeft: true,
    surface: 'webgpu-color-target',
  })
})

test('WebGPU forwards its internal color diagnostics to the host report sink, never to the console', async (t) => {
  installGpuGlobals()
  // In a page (#945): the colour received is the report's, not a line of the page's console.
  const page = globalThis as { window?: unknown }
  const had = 'window' in page
  page.window ??= globalThis
  t.after(() => void (had || delete page.window))
  const info = t.mock.method(console, 'info', () => {})
  const events: Array<{ phase: string; message: string; context: Record<string, unknown> }> = []
  const { device } = mockGpu()
  const { fixture, backend } = quadBackend(device, {
    clearColor: 0x2a303c,
    onDiagnostic: (event) => events.push(event),
  })
  assert.ok(!info.mock.calls.some(({ arguments: [line] }) => /background colour/.test(`${line}`)))
  assert.deepEqual(events[0], {
    phase: 'clear-color-input',
    message: 'Background colour received by Trillion3D WebGPU',
    context: { pipelineVersion: 1, clearColor: '#2a303c', value: 0x2a303c, source: 'host' },
  })
  await backend.prepare()
  backend.render(camera())
  assert.ok(events.some((event) => event.phase === 'first-render-path'))
  backend.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
})

test('trace diagnostics retain one bounded snapshot for every rendered frame', async () => {
  installGpuGlobals()
  const events: Array<{ phase: string; message: string; context: Record<string, unknown> }> = []
  const fixture = quadScene()
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  )
  const { device } = mockGpu({ packed: packDagSelection(collected.roots) })
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    diagnosticDetail: 'trace' as never,
    onDiagnostic: (event: { phase: string; message: string; context: Record<string, unknown> }) =>
      events.push(event),
  } as never)
  assert.ok(backend.flush, 'this backend always publishes flush()')
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    backend.render(camera())
    await backend.flush()
    // Two host images, and no convergence image: with no streamed texture, the barrier has
    // nothing to converge and yields nothing.
    const frames = events.filter((event) => event.phase === 'frame')
    assert.equal(frames.length, 2)
    assert.deepEqual(
      frames.map((event) => event.context.frame),
      [1, 2],
    )
    assert.ok(frames.every((event) => typeof event.context.submission === 'number'))
    assert.ok(
      frames.every((event) => event.context.coverage && typeof event.context.coverage === 'object'),
    )
    assert.equal(events.filter((event) => event.phase === 'cpu-selection').length, 0)
    assert.ok(events.some((event) => event.phase === 'residency-queue'))
    assert.ok(
      events.some((event) => event.phase === 'gpu-selection-current-frame'),
      'gpu-selection-current-frame',
    )
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('summary diagnostics keep frame traces disabled', async () => {
  installGpuGlobals()
  const events: Array<{ phase: string; message: string; context: Record<string, unknown> }> = []
  const { device } = mockGpu()
  const { fixture, backend } = quadBackend(device, {
    diagnosticDetail: 'summary' as never,
    onDiagnostic: (event) => events.push(event),
  })
  assert.ok(backend.flush, 'this backend always publishes flush()')
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    assert.equal(
      events.some((event) => event.phase === 'frame'),
      false,
    )
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
