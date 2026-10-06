// A reopen that remains — a lost device, an option the engine cannot take in place — keeps
// the image on screen, is said with its cause, and never fails a wait on the view's pages.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuPresenter } from '../../gpu/core/presentation.ts'
import { markWebgpuLost } from '../../webgpu/pages/io/lost.ts'
import { listenWorldNotices } from '../diagnostic/worldNotices.ts'
import type { MeasuredWorld } from '../session/explorer.ts'
import { Scene } from './scene.ts'
import { awaitViewPages } from './worldSession.ts'
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts'

/** A canvas that says what it shows: `blank` once configured or unconfigured, as WebGPU blanks
 *  it, else the label of the last image presented into it. */
function watchedCanvas() {
  const seen = { shown: 'nothing', blanks: 0 }
  const blank = () => ((seen.shown = 'blank'), seen.blanks++)
  const view = {}
  const context = {
    configure: blank,
    unconfigure: blank,
    getCurrentTexture: () => ({ createView: () => view }),
  }
  const canvas = { width: 1, height: 1, getContext: () => context } as never as HTMLCanvasElement
  /** An encoder whose pass into the canvas shows `label`. */
  const encoder = (label: string) =>
    ({
      beginRenderPass(pass: GPURenderPassDescriptor) {
        if ([...pass.colorAttachments][0]?.view === view) seen.shown = label
        return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }
      },
    }) as unknown as GPUCommandEncoder
  return { canvas, seen, encoder }
}

/** The display's frames, run when the test says. */
function displayFrames() {
  const saved = globalThis.requestAnimationFrame
  const queue: FrameRequestCallback[] = []
  globalThis.requestAnimationFrame = (callback) => queue.push(callback)
  return {
    run: () => queue.splice(0).forEach((callback) => callback(performance.now())),
    restore: () => void (globalThis.requestAnimationFrame = saved),
  }
}

/** The notices said so far under `phase`. */
function said(phase: string) {
  const heard: Record<string, unknown>[] = []
  const stop = listenWorldNotices((notice) => {
    if (notice.phase === phase) heard.push(notice.context ?? {})
  })
  return { heard, stop }
}

test('a lost device reopens the session, every frame between shows the last image, then one is drawn', async (t) => {
  t.mock.method(console, 'error', () => {})
  const frames = displayFrames(),
    reopens = said('session-reopen')
  const { canvas, seen, encoder } = watchedCanvas()
  const { device } = fakeDevice()
  let opened = 0,
    redrawn = 0, // frames of the session opened after the loss
    grant = Promise.resolve()
  const lost: Array<() => void> = []
  const open = (async (on: HTMLCanvasElement) => {
    const label = `session ${++opened}`
    const presenter = createGpuPresenter(device, on) // created at once, drawn later
    await grant
    const rt = { run: { lost: false }, gpu: { presenter }, diag: { engineDiagnostic() {} } }
    lost.push(() => markWebgpuLost(rt as never, { reason: 'unknown', message: 'reset' }))
    const { session } = sessionStandIn()
    const image = { createView: () => ({}) } as GPUTexture
    session.render = () => {
      if (label === 'session 2') redrawn++
      presenter.present(encoder(label), image, 1, 1)
      return {}
    }
    session.dispose = () => presenter.dispose()
    return session
  }) as unknown as Open
  const scene = new Scene(() => Promise.reject(new Error('no loader')))
  const runtime = runtimeOf(
    scene,
    Promise.resolve(),
    (error) => assert.fail(String(error)),
    open,
    undefined,
    canvas,
  )
  scene.add(object.mesh(geometry.box()))
  await runtime.settled()
  runtime.render()
  assert.equal(seen.shown, 'session 1')
  const blanks = seen.blanks
  let release!: () => void
  grant = new Promise((done) => (release = done))
  lost[0]() // the engine withdraws its image as the device goes (`lost.ts`)
  runtime.renew('device-lost') // then the world, granted another (`worldRecovered`)
  for (let frame = 0; frame < 3; frame++) {
    frames.run()
    assert.equal(runtime.render(), null, 'no session draws yet')
    assert.equal(seen.shown, 'session 1', `frame ${frame}: the last image stays`)
  }
  release()
  await runtime.settled()
  await new Promise(setImmediate)
  // The frames asked while it opened are one frame, drawn by the session opened.
  assert.deepEqual([seen.shown, seen.blanks], ['session 2', blanks + 1], 'blank only in its task')
  assert.equal(redrawn, 1, 'drawn once, however many frames were asked meanwhile')
  frames.run()
  await new Promise(setImmediate)
  runtime.dispose()
  frames.restore()
  reopens.stop()
  assert.equal(seen.shown, 'blank', 'a disposed world withdraws its image')
  assert.equal(reopens.heard.length, 1)
  const [{ cause, defect, drawn, durationMs, framesWithoutImage }] = reopens.heard
  assert.deepEqual([cause, defect, drawn, framesWithoutImage], ['device-lost', false, true, 3])
  assert.ok(Number(durationMs) >= 0)
})

/** A session whose page waits settle as `waits` says, one per call; closed, a wait fails as the
 *  engine's does, with the reason its dispose gives (`lifecycle.ts`). */
function waitingSession(...waits: Array<'at once' | 'until closed'>) {
  const { session } = sessionStandIn()
  let fail = (_reason: unknown) => {}
  const failed: unknown[] = []
  Object.assign(session, {
    awaitPages: () =>
      waits.shift() === 'at once'
        ? Promise.resolve()
        : new Promise(
            (_done, reject) => (fail = (reason) => (failed.push(reason), reject(reason))),
          ),
    dispose: () => fail(new DOMException('The session closed', 'AbortError')),
  })
  return { session, failed }
}

test('awaitPages settles after scene adds, and across a reopen, never rejected by it', async () => {
  const sessions = [waitingSession('at once', 'until closed'), waitingSession('at once')]
  let opened = 0
  const open = (async () => sessions[opened++].session) as unknown as Open
  const scene = new Scene(() => Promise.reject(new Error('no loader')))
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open)
  const view = () => runtime.explorer as MeasuredWorld | null
  scene.add(object.mesh(geometry.box()), object.mesh(geometry.box(2, 1, 1)))
  await awaitViewPages(runtime, view)
  assert.equal(opened, 1, 'the scene added, its pages resident')
  const waiting = awaitViewPages(runtime, view)
  await new Promise(setImmediate)
  runtime.renew('option') // the first session's wait is still on its pages
  await waiting
  runtime.dispose()
  assert.equal(opened, 2, 'the wait carried on with the session opened again')
  const [reason] = sessions[0].failed as DOMException[]
  assert.deepEqual([reason?.name, reason?.message], ['AbortError', 'The session closed'])
})
