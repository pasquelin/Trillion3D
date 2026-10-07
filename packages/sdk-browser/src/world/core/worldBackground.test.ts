import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import { listen } from '../../../../sdk-core/src/world/math/observed.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { createFrameGateCore } from '../../frame/gateCore.ts'
import { createBlendScene } from '../../cluster/blendSceneRecord.ts'
import { setWebgpuClearColor } from '../../webgpu/pages/io/clearColor.ts'
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts'
import { createExplorerSceneApi } from '../api/sceneApi.ts'
import type { Engine } from '../../engine/types.ts'
import type { MeasuredWorld } from '../session/explorer.ts'
import { createWorldBackground } from './worldBackground.ts'
import { createWorldLink } from './worldLink.ts'
import { Scene } from './scene.ts'

const noLoad = () => Promise.reject(new Error('no model in this test'))

/** A world's scene wired as the runtime wires it, its session a recorder of clear colours. */
function wiredScene() {
  const scene = new Scene(noLoad)
  const background = createWorldBackground(scene)
  const calls = { invalidate: 0, schedule: 0 }
  scene._link = createWorldLink({
    contents: {} as never,
    lights: {} as never,
    invalidate: () => calls.invalidate++,
    relight: () => {},
    schedule: () => calls.schedule++,
  })
  const written: (number | undefined)[] = []
  const session = {
    setClearColor: (hex?: number) => void written.push(hex),
  } as unknown as MeasuredWorld
  return { scene, background, calls, written, session }
}

test('a background changed after the first frame is the next frame clear colour, in place', () => {
  const { scene, background, calls, written, session } = wiredScene()
  scene.background = new Color(0x223344)
  background.write(session) // first frame
  scene.background = new Color(0xffcc88)
  // No change of structure: nothing resolved, the session kept, one frame asked.
  assert.equal(calls.schedule, 0)
  assert.equal(calls.invalidate, 2)
  background.write(session)
  assert.deepEqual(written, [0x223344, 0xffcc88])
  // A frame where it did not change writes nothing, nor does the same colour set again.
  background.write(session)
  scene.background = new Color(0xffcc88)
  background.write(session)
  assert.equal(written.length, 2)
})

test('a colour written in place is taken too, and a replaced one no longer speaks', () => {
  const { scene, background, written, session } = wiredScene()
  const sky = new Color(0x000000)
  scene.background = sky
  background.write(session)
  sky.setHex(0x3366ff)
  background.write(session)
  scene.background = null
  background.write(session)
  sky.setHex(0xffffff)
  background.write(session)
  assert.deepEqual(written, [0x000000, 0x3366ff, undefined])
})

test('a colour another owner hears keeps its owner when the background lets it go', () => {
  const { scene, calls } = wiredScene()
  const shared = new Color(0x000000)
  let heard = 0
  listen(shared, () => heard++) // a light or a material holding the same colour
  scene.background = shared
  scene.background = shared // the same colour set twice is chained once
  const asked = calls.invalidate
  shared.setHex(0x112233)
  assert.deepEqual([calls.invalidate, heard], [asked + 1, 1])
  scene.background = null // one frame asked for the default
  shared.setHex(0x445566)
  assert.deepEqual([calls.invalidate, heard], [asked + 2, 2])
})

test('a value that says it is a colour and cannot give its hex is refused', () => {
  const scene = new Scene(noLoad)
  assert.throws(
    () => (scene.background = { isColor: true } as never),
    (error: { code?: string }) => error.code === 'UNSUPPORTED_SCENE_UPDATE',
  )
})

test('a picture background is refused by name', () => {
  const scene = new Scene(noLoad)
  assert.throws(
    () => (scene.background = new Texture(null) as never),
    (error: { code?: string }) => error.code === 'UNSUPPORTED_SCENE_UPDATE',
  )
  assert.equal(scene.background, null)
})

test('the session writes the engine, the default colour for none', () => {
  const taken: number[] = []
  const engine = { setClearColor: (hex: number) => taken.push(hex) } as unknown as Engine
  const api = createExplorerSceneApi({ check: () => {}, engine } as never)
  api.setClearColor(0x102030)
  api.setClearColor()
  assert.deepEqual(taken, [0x102030, 0x171d28])
})

test('WebGPU: the passes read the new colour, the frame is not held on the old one', () => {
  const gate = createFrameGateCore(1)
  const scene = createBlendScene(0x000000, [])
  const rt = { setup: { scene }, run: { clearColor: 0, gate } } as unknown as WebgpuPagesRuntime
  const { scene: moved, resources } = gate.revisions
  setWebgpuClearColor(rt, 0xffffff)
  assert.equal(rt.run.clearColor, 0xffffff)
  assert.deepEqual(scene.background, { isColor: true, r: 1, g: 1, b: 1 })
  // The held frame is broken, and nothing is walked again: the scene revision stays.
  assert.equal(gate.revisions.scene, moved)
  assert.notEqual(gate.revisions.resources, resources)
})
