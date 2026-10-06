// #831: a render-size change remade the targets the held way — released, the frame held for the
// device's answer — a flicker as the camera started or stopped. At the display's size in place,
// they are made beside those, which the frames go on drawing into, and swapped in at a frame's entry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { SHADOW_LIMITS, camera, quadScene } from '../testScenes.fixture.ts'
import { MANIFEST_IDENTITY } from '../../../backend/pagesBackend.fixture.ts'
import { createWebgpuPagesRuntime } from '../runtime.ts'
import { prepareWebgpuBackend } from './prepare.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { flushWebgpuPages } from '../render/flush.ts'
import { disposeWebgpuPages } from '../io/metrics.ts'
import { renderExtent } from '../../../frame/renderScaleOption.ts'
import { refusing } from './refusing.fixture.ts'
import { installGpuDeviceLedger } from '../../../gpu/core/deviceLedger.ts'
import * as G from '../../../host/graph/graph.fixture.ts'
import { importHostTexture } from '../../../host/textureImport.ts'
import type { HostTexture } from '../../../host/resources.ts'
import { appendWebgpuTexture } from '../io/appendTexture.ts'

installGpuGlobals()
const HDR = 'Trillion3D HDR lighting',
  HISTORY = 'Trillion3D TAA history'
const DISPLAY: [number, number] = [3456, 2234],
  ASKED = renderExtent(DISPLAY[0], 0.75)

/** The quad at dynamic resolution on the display, on a device that refuses the `HDR` target
 *  `ASKED` wide `refusals` times, under a ledger whose limit `box` holds; `frames` draws and says,
 *  at each, whether a grant held it. */
async function session(refusals = 0) {
  const gpu = refusing(
    'createTexture',
    HDR,
    (raise, { size }) => {
      if (size?.width === ASKED && refusals-- > 0) raise('Out of memory')
    },
    { limits: { ...SHADOW_LIMITS, maxTextureDimension2D: 16384 }, compute: true },
  )
  const box = { limit: 1e12 },
    ledger = installGpuDeviceLedger(gpu.device, { limit: () => box.limit })
  const scene = quadScene()
  const rt = createWebgpuPagesRuntime({
    ...scene,
    metadata: { ...scene.metadata, ...MANIFEST_IDENTITY },
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [...DISPLAY],
    renderScale: 'auto',
  })
  const frames = async (count: number, seen: (asked: boolean) => void = () => {}) => {
    for (let k = 0; k < count; k++) {
      renderWebgpuPages(rt, camera())
      seen(rt.gpu.targetGrant !== undefined)
      await flushWebgpuPages(rt, { image: false })
    }
  }
  const live = (label: string) =>
    gpu.textures.filter((t) => !!t.label?.startsWith(label) && !t.destroyed)
  const dispose = () => {
    disposeWebgpuPages(rt)
    scene.geometry.dispose()
    scene.material.dispose()
  }
  await prepareWebgpuBackend(rt, gpu.device)
  await frames(2)
  return { rt, gpu, box, ledger, frames, live, dispose }
}

test('a scale change with targets in place is made aside: never held, old ones freed at the swap', async () => {
  const s = await session()
  try {
    const old = s.live(HDR)[0],
      history = s.live(HISTORY),
      temporal = s.rt.gpu.temporal
    assert.equal(old.width, DISPLAY[0])
    assert.ok(history.length > 0)
    s.rt.scale.set({ min: 0.5, max: 0.75 })
    const asked: boolean[] = [],
      drawnIn: number[] = []
    await s.frames(4, (held) => {
      asked.push(held)
      drawnIn.push(s.rt.gpu.allocatedSize[0])
      if (s.rt.gpu.allocatedSize[0] === DISPLAY[0]) assert.equal(old.destroyed, false)
    })
    assert.deepEqual(asked, [false, false, false, false], 'no frame waits for the grant')
    assert.equal(drawnIn[0], DISPLAY[0], 'the frames draw in the targets in place meanwhile')
    assert.deepEqual(s.rt.gpu.allocatedSize, [ASKED, renderExtent(DISPLAY[1], 0.75)])
    assert.equal(old.destroyed, true, 'freed once swapped out')
    assert.deepEqual(s.live(HDR), [s.rt.gpu.hdrTexture], 'one set left')
    assert.equal(s.rt.gpu.temporal, temporal)
    assert.deepEqual(s.live(HISTORY), history, 'the same history, at the same display size')
  } finally {
    s.dispose()
  }
})

test('targets refused aside fall back to the held grant, then drawn at the size asked', async () => {
  const s = await session(1)
  try {
    s.rt.scale.set({ min: 0.5, max: 0.75 })
    const asked: boolean[] = []
    await s.frames(5, (held) => asked.push(held))
    assert.equal(asked[0], false, 'asked aside first')
    assert.ok(asked.includes(true), `refused there, the frame is held for the grant: ${asked}`)
    assert.equal(s.rt.gpu.allocatedSize[0], ASKED)
    assert.equal(s.live(HDR).length, 1)
  } finally {
    s.dispose()
  }
})

test('targets that do not fit beside those in place are asked the held way, those released first', async () => {
  const s = await session()
  try {
    // Room for a few bytes more than what is held: never for a second set.
    s.box.limit = s.ledger.bytes + 1024
    s.rt.scale.set({ min: 0.5, max: 0.75 })
    const asked: boolean[] = []
    await s.frames(3, (held) => asked.push(held))
    assert.equal(asked[0], true, 'held at once: nothing is made aside')
    assert.equal(s.rt.gpu.allocatedSize[0], ASKED)
    assert.equal(s.ledger.refusal, undefined)
  } finally {
    s.dispose()
  }
})

// A texture that comes while targets are made aside: its feedback variant is installed at the
// entry that swaps in a set made for the variant before it. The set swapped in has the target the
// pipelines in place write, or the resolve would bind none.
test('targets made aside under the old feedback variant take the target of the one installed since', async () => {
  const s = await session()
  try {
    assert.equal(s.rt.vis.writesFeedback, false, 'the quad wears no texture')
    const map = G.dataTexture(new Uint8Array(64), 4, 4) as unknown as HostTexture
    await appendWebgpuTexture(s.rt, importHostTexture(map), 'color')
    s.rt.scale.set({ min: 0.5, max: 0.75 })
    const followed: boolean[] = []
    const follows = () => followed.push(!!s.rt.gpu.feedbackTexture === s.rt.vis.writesFeedback)
    // Asked aside, and the variant asked; both answered before the next entry.
    await s.frames(1, follows)
    await new Promise((settle) => setTimeout(settle))
    await s.frames(2, follows)
    assert.equal(s.rt.vis.writesFeedback, true, 'the variant that writes it is installed')
    assert.equal(s.rt.gpu.allocatedSize[0], ASKED, 'the targets made aside are in place')
    assert.deepEqual(followed, [true, true, true], 'each frame drew with the target it writes')
  } finally {
    s.dispose()
  }
})
