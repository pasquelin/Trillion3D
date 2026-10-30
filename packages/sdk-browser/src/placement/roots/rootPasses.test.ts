// The roots' pass settles its command buffer whatever the end of its compute pass or the drop of the encoder throws
// (`rootPasses.ts`): an encoder left open would hold every resource retired meanwhile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { destroyRetired, onSettled, retire } from '../../gpu/core/frameRetire.ts'
import { createImagePart } from '../../frame/render/encoder.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { sendRootWorlds } from './rootWorlds.ts'
import { rootsOnGpu } from './rootPasses.ts'

/** A runtime whose roots' pass opens on the part `make` returns and ends as `end` does. */
function rootsRuntime(end: (opened: GPUCommandEncoder) => void) {
  const fake = fakeDevice(),
    device = fake.device as unknown as GPUDevice
  const failures: string[] = []
  const rt = {
    gpu: { device },
    run: { lost: false },
    layout: { selectionRoots: [{ world: { elements: new Float64Array(16) } }] },
    compose: {
      roots: 64,
      parentOf: new Uint32Array(64).fill(NO_INDEX),
      parentIds: new Set(),
    },
    timing: { frameEncoder: undefined, gpuTiming: undefined },
    capture: { capturing: false },
    diag: { diagnosticFailure: (code: string) => void failures.push(code) },
  } as never as Parameters<typeof rootsOnGpu>[0]
  let part: GPUCommandEncoder | undefined
  const open = {
    begin(make: () => GPUCommandEncoder) {
      part = make()
      return open
    },
    end() {
      end(part!)
      return part
    },
  }
  sendRootWorlds(rt, device)
  rt.rootWorlds!.pass = {
    open,
    encoder: () => createImagePart(rt, device, false),
  } as never
  return { rt, device, failures }
}

test('a roots pass whose end throws is dropped: the encoder settles and the end error is thrown', () => {
  const held = { destroyed: false, destroy: () => void (held.destroyed = true) }
  const f = rootsRuntime(() => {
    throw new Error('end failed')
  })
  retire(f.device, held)
  assert.throws(() => rootsOnGpu(f.rt).roots({ view: {} as GPUTextureView } as never), /end failed/)
  destroyRetired(f.device)
  assert.equal(held.destroyed, true)
  assert.deepEqual(f.failures, ['roots-pass-end-failed'])
})

test('a roots pass whose encoder cannot be dropped reports the release and keeps the original error', () => {
  const f = rootsRuntime((opened) => {
    onSettled(opened, () => {
      throw new Error('release failed')
    })
    throw new Error('end failed')
  })
  assert.throws(() => rootsOnGpu(f.rt).roots({ view: {} as GPUTextureView } as never), /end failed/)
  assert.deepEqual(f.failures, ['roots-pass-end-failed', 'roots-pass-abandon-failed'])
})
