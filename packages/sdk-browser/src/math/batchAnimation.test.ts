// The WebAssembly animation sampler (`batchAnimation.ts`, `packages/page-codec-wasm/src/anim.rs`)
// lent to the mixer: rigs on hostile clips — lines, steps and splines, near-aligned and opposite
// rotations, keys at one time, a single key, signed zeros, a NaN key —, played the same frames
// three ways: without the sampler (`sample`, track by track), with it on the WebAssembly path, and
// with it on its JavaScript path. Every written number must carry the same bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSdkWasm } from './wasm/sdkWasm.ts'
import { mathGovernor, prepareMathBatch } from './batchState.ts'
import { lendAnimationSampler } from './batchAnimation.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import {
  Mixer,
  advanceMixers,
  lendActionSampler,
} from '../../../sdk-core/src/world/animation/mixer.ts'
import type { Clip, Track } from '../../../sdk-core/src/world/animation/clip.ts'
import { assertBits } from '../../../../tests/kit/assert/bits.ts'

await prepareSdkWasm(readFileSync(join(import.meta.dirname, './wasm/kernels.wasm')))

let seed = 7
const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed / 4294967296)
const unit = () => {
  const q = [random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5],
    length = Math.hypot(...q)
  return q.map((v) => v / length)
}

/** A rotation track whose keys turn far, barely (the slerp's line), or to the opposite side. */
function rotations(name: string, interpolation?: 'step' | 'cubic'): Track {
  const keys = 6,
    times = Float32Array.from([0, 0.2, 0.2, 0.5, 0.9, 1.3])
  const per = interpolation === 'cubic' ? 3 : 1,
    values = new Float32Array(keys * 4 * per)
  let previous = unit()
  for (let k = 0; k < keys; k++) {
    const q =
      k % 3 === 1 ? previous.map((v) => v + 1e-9) : k % 3 === 2 ? previous.map((v) => -v) : unit()
    for (let part = 0; part < per; part++) values.set(q, (k * per + part) * 4)
    previous = q
  }
  return { name, kind: 'quaternion', times, values, interpolation }
}

/** A vector track with signed zeros, a repeated time, and for `nan` a NaN value. */
function vectors(name: string, interpolation?: 'step' | 'cubic', nan = false): Track {
  const times = Float32Array.from([0, 0.25, 0.25, 0.75, 1]),
    per = interpolation === 'cubic' ? 3 : 1
  const values = Float32Array.from({ length: times.length * 3 * per }, (_, i) =>
    i % 7 === 3 ? -0 : (random() - 0.5) * 4,
  )
  if (nan) values[4] = NaN
  return { name, kind: 'vector', times, values, interpolation }
}

const clips: Clip[] = [
  {
    name: 'lines',
    duration: 1.3,
    tracks: [rotations('a.quaternion'), vectors('a.position'), vectors('a.scale')],
  },
  {
    name: 'steps and splines',
    duration: 1,
    tracks: [rotations('a.quaternion', 'step'), vectors('a.position', 'cubic', true)],
  },
  {
    name: 'one key, and weights',
    duration: 0.5,
    tracks: [
      {
        name: 'a.position',
        kind: 'vector',
        times: Float32Array.of(0.1),
        values: Float32Array.of(1, -0, 2),
      },
      rotations('a.quaternion', 'cubic'),
      vectors('a.morphTargetInfluences'),
    ],
  },
]

/** One rig a clip, played `frames` frames of varied lengths; every written number, in order. */
function play() {
  const scene = new Object3D(),
    nodes: (Object3D & { morphTargetInfluences: number[] })[] = []
  for (const [rank, clip] of clips.entries()) {
    const root = new Object3D(),
      node = Object.assign(new Object3D(), { morphTargetInfluences: [0, 0, 0] })
    node.name = 'a'
    root.add(node)
    scene.add(root)
    nodes.push(node)
    const action = new Mixer(root).clipAction(clip)
    action.loop = (['repeat', 'pingpong', 'once'] as const)[rank]
    action.timeScale = rank === 1 ? -1.5 : 1
    action.play()
  }
  const written: number[] = []
  for (let frame = 0; frame < 240; frame++) {
    advanceMixers(scene, [1 / 60, 0, 0.37, 1 / 144][frame % 4])
    for (const node of nodes)
      written.push(
        ...node.position.elements,
        ...node.quaternion.elements,
        ...node.scale.elements,
        ...node.morphTargetInfluences,
      )
  }
  return written
}

test('the WebAssembly sampler writes the bits of the track-by-track sample, on both its paths', async () => {
  lendActionSampler(null)
  const reference = play()
  await lendAnimationSampler()
  await prepareMathBatch('wasm')
  const byWasm = play()
  await prepareMathBatch('js')
  const byJs = play()
  await prepareMathBatch('auto')
  lendActionSampler(null)
  const played = mathGovernor().metrics().operations.animSampleTracks
  assert.ok(played && played.wasmSamples > 0 && played.jsSamples > 0, 'both paths played')
  assert.ok(reference.some(Number.isNaN), 'the NaN key reaches a written number')
  assertBits(byWasm, reference, 'WebAssembly')
  assertBits(byJs, reference, 'JavaScript')
})
