// #725, #483 rule 5: out of memory on a frame target is absorbed. The targets — the Hi-Z pyramid
// among them, the one occlusion path (#1483) — are granted under the device's out-of-memory check
// before a frame draws with them; what cannot be made is refused by name, never reported as a lost
// device, and nothing is dropped to make room.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { camera, disposeQuadRun, quadBackend, quadScene } from '../testScenes.fixture.ts'
import { collectClusterPages } from '../../../page/selection/selection.ts'
import { packDagSelection } from '../../../gpu/dag/selection.ts'
import { refusing } from './refusing.fixture.ts'
import type { EngineDiagnostic } from '../../../engine/types.ts'

/** The label of the Hi-Z pyramid's level 0 (`gpu/hiz/pyramid.ts`). */
const HI_Z_LEVEL_0 = 'Trillion3D Hi-Z level 0'

const COLOR = 'Trillion3D display color'

/** A quad backend drawn once at 32 × 32, on a device that answers the `label` target made at
 *  48 × 48 with `answer`, told whether the Hi-Z pyramid is alive; then resized to 48 × 48. */
async function resized(
  answer: (raise: (message: string) => void, hizAlive: boolean) => unknown,
  label = COLOR,
) {
  installGpuGlobals()
  const scene = quadScene()
  const gpu = refusing(
    'createTexture',
    label,
    (raise, { size }) => {
      const hizAlive = gpu.textures.some(
        (texture) => texture.label === HI_Z_LEVEL_0 && !texture.destroyed,
      )
      if (size?.width === 48) answer(raise, hizAlive)
    },
    {
      packed: packDagSelection(
        collectClusterPages(scene.source, scene.metadata, scene.indices, scene.associations).roots,
      ),
    },
  )
  const viewport: [number, number] = [32, 32]
  const events: EngineDiagnostic[] = []
  const mounted = quadBackend(gpu.device, {
    viewport,
    onDiagnostic: (event: EngineDiagnostic) => events.push(event),
  })
  const { fixture } = mounted,
    backend = mounted.backend
  await backend.prepare()
  const cam = camera()
  backend.render(cam)
  await backend.flush()
  viewport[0] = viewport[1] = 48
  const said = (phase: string) => events.filter((event) => event.phase === phase)
  const widths = (label: string) =>
    gpu.textures.filter((made) => made.label === label && !made.destroyed).map((made) => made.width)
  const dispose = () => {
    assert.equal(said('gpu-device-lost').length, 0, 'never reported as a lost device')
    disposeQuadRun(backend, scene)
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
  return { gpu, backend, cam, said, widths, dispose }
}

test('under pressure, the targets are refused whole: Hi-Z and its pipelines are kept', async () => {
  // The device lacks what Hi-Z holds: before, Hi-Z left to make room; now the pyramid is a target.
  const s = await resized((raise, hizAlive) => hizAlive && raise('Out of memory'))
  try {
    const visPipelines = () =>
      (s.gpu.given as Array<{ vertex?: { entryPoint: string } }>).filter(
        (made) => made?.vertex?.entryPoint === 'vis_vs',
      ).length
    const made = visPipelines()
    s.backend.render(s.cam)
    assert.equal(await s.backend.pendingFrame(), true)
    s.backend.render(s.cam)
    assert.equal(s.said('frame-targets-refused')[0]?.context.reason, 'gpu-out-of-memory')
    assert.ok(
      s.said('gpu-out-of-memory').every((event) => event.context.dropped !== 'hi-z'),
      'Hi-Z is never dropped',
    )
    assert.equal(visPipelines(), made, 'no visibility pipeline made again without Hi-Z')
    assert.ok(
      s.gpu.textures.some((texture) => texture.label === HI_Z_LEVEL_0 && !texture.destroyed),
      'a pyramid is held',
    )
  } finally {
    s.dispose()
  }
})

test('an impossible target is refused by name, the frame held, never a lost device', async () => {
  const s = await resized((raise) => raise('Out of memory'))
  try {
    const draws = s.gpu.draws.length
    s.backend.render(s.cam)
    assert.equal(await s.backend.pendingFrame(), true)
    s.backend.render(s.cam)
    const [refused] = s.said('frame-targets-refused')
    assert.equal(refused?.context.code, 'WEBGPU_FRAME_TARGETS_REFUSED')
    assert.equal(refused?.context.reason, 'gpu-out-of-memory')
    assert.deepEqual([refused?.context.width, refused?.context.height], [48, 48])
    assert.equal(s.backend.metrics().frameHeld, true, 'the previous image stays')
    assert.equal(s.gpu.draws.length, draws, 'nothing is drawn')
    assert.equal(await s.backend.pendingFrame(), false, 'the loop waits for another size')
  } finally {
    s.dispose()
  }
})

test('frame targets refused at prepare are refused by name', async () => {
  installGpuGlobals()
  const { device } = refusing('createTexture', COLOR)
  const { fixture, backend } = quadBackend(device)
  try {
    await assert.rejects(backend.prepare(), /WEBGPU_FRAME_TARGETS_REFUSED/)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

// A refused grant holds the frame, draws nothing into targets not granted, and is asked again after
// its wait (`retryAfterRefusal`), never every frame: then the frame is drawn complete. And
// `world/session-startup`: the page reads `frameHeld` as "nothing more to draw", so a frame held
// while the device answers must not say it.
test('a refused target grant holds the frame, asks again after its wait, then draws it complete', async () => {
  let refusals = 1
  const s = await resized((raise) => refusals-- > 0 && raise('Out of memory'))
  try {
    const draws = s.gpu.draws.length
    s.backend.render(s.cam)
    assert.equal(s.backend.metrics().frameHeld, false, 'not the still frame while asked')
    await s.backend.pendingFrame()
    assert.equal(s.gpu.draws.length, draws, 'held: nothing is drawn into targets not granted')
    assert.equal(s.said('frame-targets-refused').length, 1, 'refused by name, once')
    let frames = 0
    for (; frames < 1000 && s.gpu.draws.length === draws; frames++) {
      s.backend.render(s.cam)
      await s.backend.pendingFrame()
    }
    assert.ok(frames > 1, 'asked again after a wait, not at the next frame')
    assert.ok(s.gpu.draws.length > draws, 'the frame is drawn once granted')
    assert.deepEqual(s.widths(COLOR), [48], 'drawn into the granted targets, at the new size')
    await s.backend.flush()
    s.backend.render(s.cam)
    assert.deepEqual(s.backend.selectedPageIds().sort(), ['0', '1'], 'the frame is complete')
  } finally {
    s.dispose()
  }
})

test('a visibility target the device cannot make is refused by name, once, the mode kept', async () => {
  const s = await resized(() => {
    throw new TypeError('refused')
  }, 'Trillion3D visibility')
  try {
    const withheld = [...s.backend.capabilities.unsupported]
    for (let i = 0; i < 3; i++) {
      s.backend.render(s.cam)
      await s.backend.pendingFrame()
    }
    const refused = s.said('frame-targets-refused')
    assert.equal(refused.length, 1, 'asked once, not every frame')
    assert.equal(refused[0]?.context.code, 'WEBGPU_FRAME_TARGETS_REFUSED')
    assert.deepEqual([refused[0]?.context.width, refused[0]?.context.height], [48, 48])
    assert.equal(s.backend.metrics().frameHeld, true, 'the previous image stays')
    assert.deepEqual(s.backend.capabilities.unsupported, withheld, 'nothing the image has is lost')
  } finally {
    s.dispose()
  }
})
