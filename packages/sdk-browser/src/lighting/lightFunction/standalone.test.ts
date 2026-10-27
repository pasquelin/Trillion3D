// The lights whose light function the surface cache evaluates apart from the atlas: those the atlas holds no slot of, or whose slot the cache
// does not read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lightFunctionIdOf } from '../../../../sdk-core/src/world/material/lightFunctionMaterial.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { standaloneLightFunctions } from './frame.ts'
import type { LightFunctionPlan } from './plan.ts'

const material = { kind: 'lightFunction' } as unknown as Material
const id = lightFunctionIdOf(material)

/** A runtime whose store holds the lights `wearing` (true: wears the material, false: wears none), the atlas made as `atlas` says —
 *  none, or with `entryOf` the entries of the plan — and the cache a reader of it as `bounce` says. */
function runtime(
  wearing: boolean[],
  atlas: { entryOf: number[] } | undefined,
  { bounce = true, lightFunctions = true } = {},
) {
  const ids = wearing.map((_, k) => `light${k}`)
  return {
    context: { lightFunctionBounce: bounce },
    views: { active: { overrides: { lightFunctions } } },
    lights: {
      store: {
        count: ids.length,
        ids,
        lightFunctionCount: wearing.filter(Boolean).length,
        light: (name: string) => ({
          id: name,
          lightFunction: wearing[ids.indexOf(name)] ? id : undefined,
        }),
      },
      lightFunction: atlas && {
        active: true,
        atlas: { view: {} },
        plan: { entryOf: atlas.entryOf } as unknown as LightFunctionPlan,
      },
    },
  } as unknown as Parameters<typeof standaloneLightFunctions>[0]
}

test('with no atlas, every light that wears a light function is evaluated apart', () => {
  const found = standaloneLightFunctions(runtime([true, false, true], undefined))
  assert.deepEqual(
    found.map((light) => light.slot),
    [0, 2],
  )
  assert.ok(found.every((light) => light.material === material))
})

test('a light the atlas holds a slot of, and the cache reads, is not; one a limit left out is', () => {
  const found = standaloneLightFunctions(
    runtime([true, true, false, true], { entryOf: [1, 0, 0, 2] }),
  )
  assert.deepEqual(
    found.map((light) => light.slot),
    [1],
  )
})

test('the cache not among the atlas’s readers evaluates every light apart, whatever the atlas holds', () => {
  const found = standaloneLightFunctions(
    runtime([true, true], { entryOf: [1, 2] }, { bounce: false }),
  )
  assert.deepEqual(
    found.map((light) => light.slot),
    [0, 1],
  )
})

test('a view that draws no light functions, or a scene with none, evaluates none', () => {
  assert.deepEqual(
    standaloneLightFunctions(runtime([true], undefined, { lightFunctions: false })),
    [],
  )
  assert.deepEqual(standaloneLightFunctions(runtime([false, false], undefined)), [])
})
