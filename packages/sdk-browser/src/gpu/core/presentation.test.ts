import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuPresenter } from './presentation.ts'
import { claimGpuDevice } from './deviceOwners.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('presentation acquires a fresh canvas target after resizing, shared by fused and copy paths', () => {
  const sizes: number[][] = [],
    views: object[] = []
  let configured: GPUCanvasConfiguration | undefined,
    unconfigured = false
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({
      configure(value: GPUCanvasConfiguration) {
        configured = value
      },
      getCurrentTexture() {
        sizes.push([canvas.width, canvas.height])
        return {
          createView() {
            const view = {}
            views.push(view)
            return view
          },
        }
      },
      unconfigure() {
        unconfigured = true
      },
    }),
  } as unknown as HTMLCanvasElement
  const { device, passes } = fakeDevice()
  const encoder = device.createCommandEncoder()
  const presenter = createGpuPresenter(device, canvas)
  try {
    const first = presenter.targetView(32, 24),
      second = presenter.targetView(64, 48)
    assert.notEqual(first, second, 'swapchain views cannot survive a new frame')
    assert.deepEqual(sizes, [
      [32, 24],
      [64, 48],
    ])
    assert.equal(passes.length, 0, 'acquiring a target must not encode a copy pass')
    presenter.present(encoder, { createView: () => ({}) } as GPUTexture, 16, 12)
    assert.deepEqual(sizes.at(-1), [16, 12])
    assert.equal(passes[0].colors[0]?.view, views[2])
    assert.equal(configured?.format, 'bgra8unorm')
    assert.equal(configured?.alphaMode, 'opaque')
  } finally {
    presenter.dispose()
  }
  assert.equal(unconfigured, true)
})

test("a session's canvas is configured with the device itself, not the session's handle", () => {
  let given: GPUDevice | undefined
  const canvas = {
    getContext: () => ({
      configure: (value: GPUCanvasConfiguration) => (given = value.device),
      unconfigure() {},
    }),
  } as unknown as HTMLCanvasElement
  const { device } = fakeDevice()
  const claim = claimGpuDevice(device, { error() {}, closedError() {}, lost() {} })
  createGpuPresenter(claim.device, canvas).dispose()
  assert.equal(given, device)
})

test('a view presents at its rectangle: the canvas keeps its size and what it shows', () => {
  // The canvas hands a new texture once the last one is shown, as a browser frame does.
  let current = { createView: () => ({}) }
  const canvas = {
    width: 64,
    height: 48,
    getContext: () => ({
      configure() {},
      getCurrentTexture: () => current,
      unconfigure() {},
    }),
  } as unknown as HTMLCanvasElement
  const { device, passes } = fakeDevice()
  const encoder = device.createCommandEncoder()
  /** The viewport, scissor and draws `pass` set, each with its arguments. */
  const steps = (pass: (typeof passes)[number]) =>
    pass.commands.flatMap(([name, args]) => {
      const step = { setViewport: 'viewport', setScissorRect: 'scissor', draw: 'draw' }[name]
      return step ? [[step, ...args]] : []
    })
  const presenter = createGpuPresenter(device, canvas)
  const image = { createView: () => ({}) } as GPUTexture
  presenter.present(encoder, image, 16, 8, { x: 40, y: 44, width: 32, height: 8 })
  assert.equal(passes.length, 0, 'no whole image this frame: the canvas keeps the last one')
  presenter.present(encoder, image, 64, 48)
  presenter.present(encoder, image, 16, 8, { x: 40, y: 44, width: 32, height: 8 })
  assert.deepEqual([canvas.width, canvas.height], [64, 48], 'the canvas is not resized')
  assert.equal(passes[1].colors[0]?.loadOp, 'load')
  assert.deepEqual(steps(passes[1]), [
    ['viewport', 40, 44, 24, 4, 0, 1],
    ['scissor', 40, 44, 24, 4],
    ['draw', 3, 1, 0, 40 + 44 * 65536],
  ])
  presenter.present(encoder, image, 16, 8, { x: 64, y: 0, width: 16, height: 8 })
  assert.equal(passes.length, 2, 'a rectangle outside the canvas draws nothing')
  current = { createView: () => ({}) }
  presenter.present(encoder, image, 16, 8, { x: 40, y: 44, width: 32, height: 8 })
  assert.equal(passes.length, 2, 'the next frame, not yet drawn whole, keeps its last image')
  presenter.dispose()
})
