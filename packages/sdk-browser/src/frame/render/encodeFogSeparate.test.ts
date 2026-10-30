import test from 'node:test'
import assert from 'node:assert/strict'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import {
  finishSeparateFog,
  planSeparateFog,
  separateFogTarget,
  type FogSeparateState,
} from './encodeFogSeparate.ts'

const hdr = {} as GPUTextureView
const encoder = {} as GPUCommandEncoder
const first = {} as GPUTextureView

function runtime(fog: object | undefined, state?: FogSeparateState) {
  return {
    context: {},
    lights: { store: { unlit: false, environment: fog ? { fog } : {} } },
    run: { diagnostic: 'beauty' },
    gpu: {
      hdrView: hdr,
      targetSize: [64, 32],
      displaySize: [64, 32],
      localFog: { plan: { count: 0 } },
      fogSeparate: state,
      deferred: { usesContract: true, fogBinding: () => ({}) },
    },
  } as unknown as WebgpuPagesRuntime
}

function stateWith(calls: string[], composed: boolean, filtered = false): FogSeparateState {
  return {
    seen: -1,
    revision: undefined,
    composed,
    bytes: 0,
    look: {
      width: 64,
      height: 32,
      blurScale: 1,
      blurControl: 0.5,
      maxLuminance: 10,
      spread: 0.1,
      amountScale: 1,
      amountPower: 1,
    },
    gpu: {
      colourView: () => first,
      blur: () => {
        calls.push('blur')
        return filtered
      },
      upsample: () => calls.push('upsample'),
      dispose: () => calls.push('dispose'),
    },
  } as unknown as FogSeparateState
}

test('the clouds compose into the fog textures only while an image is planned for them', () => {
  const calls: string[] = []
  const planned = runtime({}, stateWith(calls, true))
  assert.equal(separateFogTarget(planned), first)
  const state = stateWith(calls, true)
  state.look = undefined
  assert.equal(separateFogTarget(runtime({}, state)), undefined)
  assert.equal(separateFogTarget(runtime({})), undefined)
})

test('the textures are blurred and laid over the image once, and only if the fog was composed into them', () => {
  const calls: string[] = []
  const rt = runtime({}, stateWith(calls, true))
  finishSeparateFog(rt, encoder)
  finishSeparateFog(rt, encoder)
  assert.deepEqual(calls, ['blur', 'upsample'])
  const skipped = runtime({}, stateWith(calls, false))
  finishSeparateFog(skipped, encoder)
  assert.deepEqual(calls, ['blur', 'upsample'])
  assert.equal(skipped.gpu.fogSeparate?.look, undefined)
})

test('a fog that does not ask for the scattering is drawn plainly, and the textures a view made are let go', () => {
  const calls: string[] = []
  const rt = runtime({}, stateWith(calls, true))
  assert.equal(planSeparateFog(rt, {} as GPUDevice, {} as EngineCamera, false), false)
  assert.deepEqual(calls, ['dispose'])
  assert.equal(rt.gpu.fogSeparate, undefined)
})

test('the history is marked as written, at this image and under this temporal state, only where the filter ran', () => {
  const calls: string[] = []
  const ran = runtime({}, stateWith(calls, true, true))
  Object.assign(ran, { run: { frame: 7, gate: { temporalRevision: 3 } } })
  finishSeparateFog(ran, encoder)
  assert.equal(ran.gpu.fogSeparate?.seen, 7)
  assert.equal(ran.gpu.fogSeparate?.revision, 3)
  const idle = runtime({}, stateWith(calls, true, false))
  Object.assign(idle, { run: { frame: 8, gate: { temporalRevision: 4 } } })
  finishSeparateFog(idle, encoder)
  assert.equal(idle.gpu.fogSeparate?.seen, -1)
  assert.equal(idle.gpu.fogSeparate?.revision, undefined)
})
