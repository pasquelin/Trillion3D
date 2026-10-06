// The blend and water programs are keyed as the opaque resolve's (`createForwardVariants`): every
// frame is lit by a program that holds each code path its lights need — the shadow read where a
// light holds a shadow slot, the rectangle's term where one is a rectangle —, the one its key names
// once compiled, never compiled during a frame; prepare compiles the first frame's and its twin with
// every code path.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createForwardVariants,
  FULL_CONTRACT,
  leavesOut,
  type ContractKey,
} from '../../lighting/deferred/contractVariants.ts'
import { createWebgpuBlendPipelines } from './pipelines.ts'
import { mountDevice } from '../water/pass.fixture.ts'
import type { BlendGpuItem } from './state.ts'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'

/** Every key a scene can ask (`contractKey`): `unshadowed` leaves out both kinds' reads, so no
 *  kind is cut beside it, and a shadowed scene casts from at least one kind. */
const KEYS: ContractKey[] = [false, true].flatMap((rectless) =>
  [
    [true, false, false],
    [false, false, false],
    [false, true, false],
    [false, false, true],
  ].map(([unshadowed, sunless, localless]) => ({
    narrow: false,
    unshadowed,
    rectless,
    sunless,
    localless,
  })),
)
/** The key the tests name: a rectless scene with shadow code. */
const RECTLESS = KEYS.find(
  (key) => key.rectless && !key.unshadowed && !key.sunless && !key.localless,
)!
const settled = () => new Promise((resolve) => setImmediate(resolve))
/** A program with no code `key` needs left out. */
const serves = (program: ContractKey, key: ContractKey) =>
  (!program.unshadowed || key.unshadowed) &&
  (!program.rectless || key.rectless) &&
  (!program.sunless || key.sunless || key.unshadowed) &&
  (!program.localless || key.localless || key.unshadowed)

/** Variants whose programs are their keys, recording each compile. The first frame's key is
 *  narrow, as a scene's of few lights (`contractKey`): a forward pass reads no narrow list. */
async function keyed(first: ContractKey, refuse?: (key: ContractKey) => boolean) {
  const built: ContractKey[] = [],
    said: unknown[] = []
  const key = { ...first, narrow: true }
  const lit = { precompile: true, key, onFailure: (error: unknown) => said.push(error) }
  const programOf = await createForwardVariants(async (key) => {
    built.push(key)
    if (refuse?.(key)) throw new Error('REFUSED')
    return key
  }, lit)
  return { programOf, built, said }
}

test('prepare compiles the first frame’s program and its twin; a frame takes one that serves it', async () => {
  for (const first of KEYS) {
    const { programOf, built } = await keyed(first)
    assert.deepEqual(built, leavesOut(first) ? [first, FULL_CONTRACT] : [first])
    assert.deepEqual(programOf(first), first, 'the first frame is lit by its own program')
    for (const key of KEYS) {
      const lent = programOf(key)
      assert.ok(serves(lent, key), `${JSON.stringify(key)} lit by ${JSON.stringify(lent)}`)
      await settled()
      assert.deepEqual(programOf(key), key, 'its own program, once compiled off the frame')
    }
    assert.equal(built.length, KEYS.length, 'each key compiled once')
  }
})

test('a refused variant is said and lent the twin; a refused twin is the pass’s refusal', async () => {
  const { programOf, said } = await keyed(RECTLESS, (key) => key.rectless)
  assert.equal(said.length, 1)
  assert.deepEqual(programOf(RECTLESS), FULL_CONTRACT)
  await assert.rejects(
    keyed(RECTLESS, (key) => !key.rectless),
    /REFUSED/,
  )
})

/** The light loop of the program a blend pipeline draws with. */
const code = (pipeline: unknown) =>
  ((pipeline as GPURenderPipelineDescriptor).fragment!.module as unknown as { code: string }).code
const loopOf = (pipeline: GPURenderPipelineDescriptor) =>
  functionsOf(code(pipeline), ['declaredLight'])

test('the blends draw with the program of the frame’s key, its water composite too', async () => {
  const mount = mountDevice()
  const create = mount.device.createShaderModule.bind(mount.device)
  mount.device.createShaderModule = (descriptor) =>
    Object.assign(create(descriptor), { code: descriptor.code })
  const items = [true, false].map(
    (transmissive) => ({ transmissive, surface: { blending: 'normal' } }) as BlendGpuItem,
  )
  const first = { ...FULL_CONTRACT, narrow: true, unshadowed: true, rectless: true }
  const { blendPipelines, water } = await createWebgpuBlendPipelines(
    mount.device,
    items,
    undefined,
    true,
    undefined,
    false,
    { lit: { precompile: true, key: first } },
  )
  const composites = mount.renderPipelines
    .filter((pipeline) => pipeline.fragment!.entryPoint === 'composeWater')
    .map((pipeline) => (pipeline.fragment!.module as GPUShaderModule).label)
  assert.deepEqual(composites, ['WATER_COMPOSITE_UNSHADOWED_RECTLESS', 'WATER_COMPOSITE'])
  // The surface stage lights nothing: the module with every code path alone carries it.
  const surfaces = mount.renderPipelines.filter(
    ({ fragment }) => fragment!.entryPoint === 'fsWater',
  )
  assert.ok(surfaces.every(({ fragment }) => fragment!.module.label === 'BLEND'))
  for (const key of [first, ...KEYS]) {
    blendPipelines.lit(key)
    await settled()
    const loop = loopOf(blendPipelines.lit(key).at(0) as unknown as GPURenderPipelineDescriptor)
    assert.equal(loop.includes('isRect(light)'), !key.rectless, JSON.stringify(key))
    assert.equal(loop.includes('shadowFactor('), !key.unshadowed, JSON.stringify(key))
    // The shadow reads hold the branch of each kind the key keeps (`ShadowKinds`).
    const read = functionsOf(code(blendPipelines.lit(key).at(0)), ['vsmShadowFiltered'])
    assert.equal(read.includes('vsmHandleFromIdDirectional('), !key.sunless, JSON.stringify(key))
    assert.equal(read.includes('vsmCubeFace('), !key.localless, JSON.stringify(key))
  }
  assert.ok(water, 'the surface stage on the module with every code path')
})
