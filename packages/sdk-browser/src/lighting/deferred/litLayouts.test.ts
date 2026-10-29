import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { layoutProblems } from '../../gpu/core/wgslLayoutMatch.fixture.ts'
import { FULL_CONTRACT, CUTS, LOBELESS_KEY, type ContractKey } from './contractCuts.ts'
import { TILE_CLASS, TILE_CLASSES } from './tileClass.ts'
import {
  hairLayoutEntries,
  indirectLayoutEntries,
  localLayoutEntries,
  perLightLayoutEntries,
  sunLayoutEntries,
} from './layoutEntries.ts'
import { indirectPassWgsl } from './indirectPassWgsl.ts'
import { localPassWgsl, sunPassWgsl } from './lightPassWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { hairLightLayout } from '../../hair/hairLightPass.ts'
import { hairLightPassWgsl, hairSkyPassWgsl } from '../../hair/hairLightWgsl.ts'
import { perLightPassWgsl } from './perLightPassWgsl.ts'

installGpuGlobals()

/** The keys the lit programs are made for: the full contract, each cut alone, and the default scene's (no lobe, no contact shadow). */
const KEYS: ContractKey[] = [
  FULL_CONTRACT,
  { ...FULL_CONTRACT, narrow: true },
  { ...FULL_CONTRACT, ...LOBELESS_KEY },
  ...CUTS.map((cut) => ({ ...FULL_CONTRACT, [cut]: true })),
]

/** The classes a program of the key holds code for (`litProgram.ts`). */
const classesOf = (key: ContractKey) =>
  key.lobeless ? [TILE_CLASS.simple, TILE_CLASS.single] : TILE_CLASSES

const label = (key: ContractKey) => CUTS.filter((cut) => key[cut]).join('+') || 'full'

test('the sun, local and per-light passes bind what their text reads, under every key and class', () => {
  const problems: string[] = []
  for (const key of KEYS)
    for (const tileClass of classesOf(key)) {
      const lobes = !key.lobeless
      const contact = !key.contactless
      const profiled = !key.profileless
      const sampled = !!key.sampled
      const volume = !!key.volumeShadow
      const at = `${label(key)}${key.narrow ? ' narrow' : ''} class ${tileClass}`
      const check = (what: string, text: string, entries: GPUBindGroupLayoutEntry[]) =>
        problems.push(
          ...layoutProblems(wgslModule(text as never), [entries]).map(
            (line) => `${what} ${at}: ${line}`,
          ),
        )
      check('sun', sunPassWgsl(key, tileClass) as never, sunLayoutEntries(lobes, contact, volume))
      check(
        'local',
        localPassWgsl(key, tileClass) as never,
        localLayoutEntries(lobes, profiled, contact, sampled, volume),
      )
      check(
        'perLight',
        perLightPassWgsl(key, tileClass) as never,
        perLightLayoutEntries(lobes, profiled, contact, volume),
      )
    }
  assert.deepEqual([...new Set(problems)], [])
})

test('the indirect pass binds what its text reads, under every feature', () => {
  const problems: string[] = []
  for (const key of KEYS)
    for (const tileClass of classesOf(key))
      for (const bounce of [false, true])
        for (const skyShadowing of bounce ? [false] : [false, true])
          for (const capsule of [false, true]) {
            const cubed = !key.cubeless
            const captured = !key.captureless
            const text = indirectPassWgsl({
              bounce,
              skyShadowing,
              cubed,
              capsule,
              captured,
              tileClass,
            })
            const entries = indirectLayoutEntries({
              bounce,
              skyShadowing,
              lobes: !key.lobeless,
              cubed,
              capsule,
              captured,
            })
            problems.push(
              ...layoutProblems(wgslModule(text as never), [entries]).map(
                (line) =>
                  `indirect ${label(key)} class ${tileClass} bounce ${bounce} sky ${skyShadowing} capsule ${capsule}: ${line}`,
              ),
            )
          }
  assert.deepEqual([...new Set(problems)], [])
})

test("the strands' light and sky passes bind what their text reads, under every key", () => {
  const { device } = fakeDevice()
  const hair = hairLightLayout(device) as unknown as { entries: GPUBindGroupLayoutEntry[] }
  const problems: string[] = []
  for (const key of KEYS)
    for (const sampled of [false, true]) {
      const text = wgslModule(hairLightPassWgsl(key, sampled) as never)
      const lights = hairLayoutEntries(false, !key.profileless, false, sampled, !!key.volumeShadow)
      problems.push(
        ...layoutProblems(text, [lights, hair.entries]).map(
          (line) => `hair light ${label(key)} sampled ${sampled}: ${line}`,
        ),
      )
    }
  for (const cubed of [false, true]) {
    const text = wgslModule(hairSkyPassWgsl(cubed) as never)
    const sky = indirectLayoutEntries({ bounce: false, skyShadowing: false, lobes: false, cubed })
    problems.push(
      ...layoutProblems(text, [sky, hair.entries]).map(
        (line) => `hair sky cubed ${cubed}: ${line}`,
      ),
    )
  }
  assert.deepEqual([...new Set(problems)], [])
})
