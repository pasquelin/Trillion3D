// The families of settings declared by rule are one table (`SETTING_FAMILIES`): a new row is made a
// registry entry, a switch, an accessor of the world, a writer of the explorer and a field of the
// engine's context by the code that reads the table, with no line of its own anywhere. The probe
// family below is added to a copy of the table, as the next family would be to the real one.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { familyWriters } from '../../api/familyWriters.ts'
import { resolvedFamilies } from '../engine/familySettings.ts'
import {
  flagSetting,
  numberSetting,
  rulesOf,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  memberOf,
  setterOf,
  SETTING_FAMILIES,
  type FamilyTable,
} from '../../../../sdk-core/src/runtime/settingFamilies.ts'
import { worldFamilies } from './ruledSwitches.ts'
import { ruledAccessors } from './ruledAccessors.ts'
import { createWorldSettings } from './settings.ts'
import { worldImageSettings, worldSceneSettings } from './worldFamilySettings.ts'

const PROBE_RULES = rulesOf([flagSetting('probeOn', true), numberSetting('probeSize', 4, [1, 8])])
const table: FamilyTable = {
  ...SETTING_FAMILIES,
  probe: { rules: PROBE_RULES, group: 'effects', world: 'image' },
}

/** A session that records the setter the table names for the probe family. */
const sessionStandIn = () => {
  const written: unknown[][] = []
  return { written, session: { setProbe: (...write: unknown[]) => void written.push(write) } }
}

test('a family added to the table is a setting of the registry, in the group the row names', () => {
  const settings = createWorldSettings(table) as unknown as {
    get(name: string): unknown
    entry?: unknown
  }
  assert.equal(settings.get('probeOn'), true)
  assert.equal(settings.get('probeSize'), 4)
  assert.throws(() => createWorldSettings().get('probeSize' as never), /probeSize/)
})

test('a family added to the table is a switch of the world: read, written, applied and watched through its session setter', () => {
  const settings = createWorldSettings(table)
  const families = worldFamilies(settings, table) as unknown as Record<
    string,
    {
      values(): Record<string, unknown>
      set(options: object): void
      page(options: object): void
      watch(session: () => unknown, invalidate: () => void): void
      apply(opened: unknown, given: object): void
    }
  >
  const { written, session } = sessionStandIn()
  let asked = 0
  families.probe.page({ probeSize: 6 })
  assert.deepEqual(families.probe.values(), { probeOn: true, probeSize: 6 })
  families.probe.watch(
    () => session,
    () => asked++,
  )
  families.probe.set({ probeSize: 7, probeOn: false })
  assert.deepEqual(written, [
    ['probeOn', false],
    ['probeSize', 7],
  ])
  assert.equal(asked, 2, 'a frame is asked for each change')
  families.probe.set({ probeSize: null })
  assert.equal(families.probe.values().probeSize, 4, 'null gives the default back')
  assert.throws(() => families.probe.set({ probeSize: 99 }), /probeSize/)
  written.length = 0
  families.probe.apply(session, {})
  assert.deepEqual(written, [
    ['probeOn', false],
    ['probeSize', 4],
  ])
})

test('a family added to the table is an accessor of the switches and of the world: read as its settings, written after the world is checked live', () => {
  const settings = createWorldSettings(table)
  const families = worldFamilies(settings, table)
  const switches = ruledAccessors(families, table) as unknown as Record<string, unknown>
  assert.deepEqual(switches.probe, { probeOn: true, probeSize: 4 })
  const order: string[] = []
  const parts = { switches, live: () => order.push('live') } as never
  const world = worldImageSettings(parts, table) as unknown as Record<string, unknown>
  switches.probe = { probeSize: 5 }
  order.length = 0
  world.probe = { probeSize: 6 }
  assert.deepEqual(order, ['live'], 'the world is checked live before it writes')
  assert.deepEqual(world.probe, { probeOn: true, probeSize: 6 })
  assert.equal('probe' in worldSceneSettings(parts, table), false, 'a row names one interface')
})

test('every row of the real table has its member, its setter and its field in the context', () => {
  const parts = { switches: {}, live: () => undefined } as never
  const carried = [
    ...Object.keys(worldSceneSettings(parts)),
    ...Object.keys(worldImageSettings(parts)),
  ]
  const members = Object.entries(SETTING_FAMILIES)
    .filter(([, family]) => 'world' in family)
    .map(([name]) => memberOf(name))
  assert.deepEqual([...carried].sort(), [...members].sort())
  assert.equal(memberOf('exposure'), 'exposureSettings', 'the one row whose member is not its name')
  const writers = Object.keys(familyWriters({} as never, () => undefined))
  const named = Object.entries(SETTING_FAMILIES).filter(([, family]) => !('named' in family))
  assert.deepEqual(
    writers,
    named.map(([name]) => setterOf(name)),
  )
  assert.equal(setterOf('cut'), 'setCut')
  assert.equal(writers.includes('setRaster'), false, 'the raster has a writer for each setting')
})

test('a family added to the table is a writer of the explorer and a field of the engine’s context, refused like the others', () => {
  const written: Record<string, unknown> = {}
  let checked = 0
  const writers = familyWriters(written as never, () => checked++, table) as unknown as Record<
    string,
    (field: string, option: unknown) => void
  >
  writers.setProbe('probeSize', 3)
  assert.deepEqual([written.probeSize, checked], [3, 1])
  assert.throws(() => writers.setProbe('probeSize', 99), /probeSize/)
  const context = resolvedFamilies({ probeSize: 5 }, table) as unknown as Record<string, unknown>
  assert.deepEqual([context.probeSize, context.probeOn], [5, true])
  assert.ok('softwareRaster' in context, 'the real families are read beside it')
  assert.throws(() => resolvedFamilies({ probeSize: 99 }, table), /probeSize/)
  assert.throws(() => resolvedFamilies({ softwareRaster: 3 }), /softwareRaster/)
})
