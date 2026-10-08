// Each cut reads a placement's translation at its own eye, from the exact one behind the range's
// matrices (`shader/worldPoseWgsl.ts`): the kernel's text, run as is (`shaderRun`), gives the bits
// the rebase pass wrote before — the double difference, rounded once —, on random translations and
// eyes and on the edges; no pass over every placement runs, whatever the views and their eyes; a
// pose sent writes its own words alone; and a root its parent stops composing takes back the pose
// the host holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  pair,
  type Pair,
} from '../../placement/composeDoubles.fixture.ts'
import { DAG_WORLD_POSE_WGSL } from './shader/worldPoseWgsl.ts'
import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import { createCameraFrames } from './frameRanges.ts'
import { FRAME_VEC4 } from './types.ts'
import { cutOnce, kernelUniforms, packed } from './selectionHelpers.fixture.ts'
import { createGpuDagSelection } from './selection.ts'
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts'
import { packDoubles } from '../../placement/composedMotion.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const run = shaderRun<{
  atEye(t: Pair, e: Pair): number
  translationAtEye(a: number[], b: number[], e0: number[], e1: number[]): number[]
}>(DAG_WORLD_POSE_WGSL, [...DOUBLE_HELPERS, 'toF32', 'atEye', 'translationAtEye'], {
  countLeadingZeros,
})
const f32Bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]

test('a translation the kernel reads at the eye is the rebased one, bit for bit', () => {
  const next = random(1473)
  const EDGES = [NaN, 0, -0, Infinity, -Infinity, 1e39, -1e39, 1e-45, 5e-324, 2 ** 24 + 1, 1e300]
  const values: number[] = [...EDGES]
  for (let i = 0; i < 3000; i++) values.push((next() - 0.5) * 10 ** Math.floor(next() * 14 - 3))
  for (const t of values)
    for (const e of [values[Math.floor(next() * values.length)], 0, -0, t]) {
      const got = run.atEye(pair(t), pair(e)) >>> 0
      if (Number.isNaN(t - e)) assert.equal(got, 0x7fc00000, `${t} − ${e}`)
      else assert.equal(got, f32Bits(t - e), `${t} − ${e}`)
    }
})

test('a translation is taken from whole words: a low word a float move would alter keeps its bits', () => {
  const next = random(2)
  // Low words that are a single's subnormal or NaN pattern: read as floats, a backend may flush or
  // canonicalise them; read as words, the subtraction sees them whole.
  const lows = [0x00000001, 0x007fffff, 0x7fc00001, 0xffc00000, 0x80000001]
  const words = (x: number, low: number) => {
    const pair_ = pair(x)
    pair_[1] = low
    return pair_
  }
  const value = ([high, low]: number[]) => new Float64Array(new Uint32Array([low, high]).buffer)[0]
  for (let i = 0; i < 400; i++) {
    const t = [0, 1, 2].map(() => words((next() - 0.5) * 2e6, lows[i % lows.length])),
      e = [0, 1, 2].map(() => pair((next() - 0.5) * 2e6))
    const got = run.translationAtEye(
      [...t[0], ...t[1]],
      [...t[2], 0, 0],
      [...e[0], ...e[1]],
      [...e[2], 0, 0],
    )
    for (let a = 0; a < 3; a++)
      assert.equal(got[a] >>> 0, f32Bits(value(t[a]) - value(e[a])), `axis ${a}`)
  }
})

test('the cone reads the translation its primitive prepared, the one worldPose makes', () => {
  // One subtraction of the eye a primitive (`preparePrimitive`), none a page (`coneRejectsBox`).
  assert.ok(DAG_SELECTION_SHADER.includes('frames[at+AT_EYE]=world[3];'))
  const cone = DAG_SELECTION_SHADER.slice(DAG_SELECTION_SHADER.indexOf('fn coneRejectsBox'))
  assert.ok(cone.slice(0, cone.indexOf('\n}')).includes('preparedPose(w)'))
  assert.ok(!cone.slice(0, cone.indexOf('\n}')).includes('worldPose('))
})

test('the main view and a view aside, each at its own eye, run no pass over every placement', async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const gpu = mockGpu({ packed: dag })
  const selection = (await createGpuDagSelection(gpu.device, dag))!
  const aside = selection.aside()
  const main = kernelUniforms(dag, roots, wideCamera(), 0)
  const side = { ...main, cameraWorld: [main.cameraWorld[0] + 3, 1, 2] as [number, number, number] }
  for (let frame = 0; frame < 3; frame++) {
    selection.dispatch(main)
    await selection.flush()
    const encoder = gpu.device.createCommandEncoder()
    aside.dispatch(side, encoder)?.(true)
    gpu.device.queue.submit([encoder.finish()])
    await aside.flush()
  }
  assert.ok(gpu.computes.includes('dagPrepare'), 'the cuts ran')
  assert.ok(!gpu.computes.includes('rebaseWorlds'), 'no pass brings the worlds to an eye')
  selection.dispose()
  fixture.geometry.dispose()
})

test('a pose sent writes its world and its exact translation, nothing more', () => {
  const sources = [3, 1e5 + 0.37].map((x) => ({
    world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 2, -1e4 - 0.21, 1] },
  }))
  const worlds = new Float32Array(32)
  sources.forEach((source, w) => worlds.set(source.world.elements, w * 16))
  const fake = fakeDevice()
  const table = createCameraFrames(
    fake.device,
    new Float32Array(2 * FRAME_VEC4 * 4),
    2,
    (descriptor) => fake.device.createBuffer(descriptor),
    worlds,
    sources as never,
  )
  const before = fake.writes.length
  sources[1].world.elements[12] += 2.5
  worlds[16 + 12] = sources[1].world.elements[12]
  table.writeWorldOrigins(Int32Array.of(1))
  table.writeNamedWorlds(worlds, Int32Array.of(1), 1)
  assert.deepEqual(
    fake.writes.slice(before).map((write) => write.size),
    [32, 64],
    'its doubles and its matrix',
  )
})

test('a root its parent stops composing takes back the pose the host holds', async () => {
  const { fixture, uniforms, selection } = await cutOnce()
  // Its parent composes it far out of the view on the GPU, words the host never wrote.
  const [range] = selection.worldRanges
  const bytes = (range.buffer as unknown as { data: Uint8Array }).data
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, range.count * 24)
  packDoubles(words, range.count * 16, [1000, 0, 0])
  selection.composedPlacement?.(0, true)
  selection.worldsMovedOnGpu()
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 0, 'composed away')
  // Unlinked, the host's pose stands again though the host wrote nothing.
  selection.composedPlacement?.(0, false)
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 4, 'back at the pose the host holds')
  selection.dispose()
  fixture.geometry.dispose()
})
