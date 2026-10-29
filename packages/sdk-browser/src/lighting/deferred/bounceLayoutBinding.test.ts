// The bounce layout's bindings stay within the default limits of their stage (`deferred.test.ts` holds the bounce layout's count).
import test from 'node:test'
import assert from 'node:assert/strict'
import { gpuHarness } from './contractLighting.fixture.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { indirectLayoutEntries, localLayoutEntries, sunLayoutEntries } from './layoutEntries.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'

test('the bounce layout binds the screen probes result as a sampled texture, within the default limits of its stage', () => {
  gpuHarness()
  const entries = indirectLayoutEntries({ bounce: true, skyShadowing: false, lobes: true })
  const screen = entries.find((entry) => entry.binding === DEFERRED_BINDINGS.screenIndirect)
  assert.ok(
    screen?.texture && !screen.storageTexture,
    'read by load, never a fifth storage texture',
  )
  assert.equal(screen?.texture?.sampleType, 'uint', 'the history it reads is words')
  const counts = (layout: GPUBindGroupLayoutEntry[]) =>
    stageBindingCounts({
      bindGroupLayouts: [{ entries: layout }] as unknown as GPUBindGroupLayout[],
    }).filter((c) => c.kind.endsWith('Fragment'))
  // Every pass binds what it reads alone: each layout within the stage's defaults.
  for (const layout of [
    entries,
    indirectLayoutEntries({ bounce: false, skyShadowing: true, lobes: true }),
    sunLayoutEntries(true),
    localLayoutEntries(true),
  ])
    for (const { limit, kind, count } of counts(layout))
      assert.ok(count <= limitOf(limit), `${count} ${kind}`)
  const storage = counts(entries).find((c) => c.limit === 'maxStorageTexturesPerShaderStage')
  assert.equal(
    storage?.count,
    4,
    'lobes, subsurface, reflection and the short-range global illumination: the four every device grants',
  )
  // Every key of the indirect pass — bounce or not, the sky's shadowing, the ambient cubemap, the lobes — stays within the default of the stage.
  for (const bounce of [false, true])
    for (const skyShadowing of [false, true])
      for (const lobes of [false, true])
        for (const cubed of [false, true])
          for (const { limit, kind, count } of counts(
            indirectLayoutEntries({ bounce, skyShadowing, lobes, cubed }),
          ))
            assert.ok(
              count <= limitOf(limit),
              `${count} ${kind} (bounce ${bounce}, sky ${skyShadowing}, lobes ${lobes}, cubed ${cubed})`,
            )
})
